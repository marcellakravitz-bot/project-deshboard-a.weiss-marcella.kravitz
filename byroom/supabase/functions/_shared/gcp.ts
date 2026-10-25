// Google Cloud access for the By Room functions: a service-account token, resumable uploads to
// Cloud Storage, signed download links, and starting the processing job on Cloud Run.
// The service-account key lives only in the function secret GCP_SA_KEY — never in the browser or the repo.

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// RFC 3986 encoding, as Google's signature check expects (encodeURIComponent leaves !'()* alone)
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

type SA = { client_email: string; private_key: string; token_uri?: string; project_id?: string };

export const env = {
  sa: (): SA => JSON.parse(Deno.env.get("GCP_SA_KEY") ?? "{}"),
  project: () => Deno.env.get("GCP_PROJECT") ?? "",
  region: () => Deno.env.get("GCP_REGION") ?? "me-west1",
  job: () => Deno.env.get("GCP_JOB") ?? "byroom-worker",
  work: () => Deno.env.get("WORK_BUCKET") ?? "",
  archive: () => Deno.env.get("ARCHIVE_BUCKET") ?? "",
};

async function rsaKey(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

let cached: { token: string; exp: number } | null = null;

export async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const sa = env.sa();
  if (!sa.client_email) throw new Error("GCP_SA_KEY is not set");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await rsaKey(sa.private_key), enc.encode(`${head}.${claims}`));
  const r = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  if (!r.ok) throw new Error(`Google token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

/** Start a resumable upload; the browser then sends the bytes straight to Google, in chunks. */
export async function resumableSession(bucket: string, object: string, contentType: string, origin: string, size?: number) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(object)}`;
  const h: Record<string, string> = {
    authorization: `Bearer ${await accessToken()}`, "content-type": "application/json",
    "x-upload-content-type": contentType, origin,
  };
  if (size) h["x-upload-content-length"] = String(size);
  const r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify({ name: object, contentType }) });
  if (!r.ok) throw new Error(`Cloud Storage session: ${r.status} ${await r.text()}`);
  return r.headers.get("location")!;
}

export async function objectMeta(bucket: string, object: string) {
  const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`,
    { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Cloud Storage: ${r.status} ${await r.text()}`);
  return await r.json();
}

export async function deleteObject(bucket: string, object: string) {
  const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!r.ok && r.status !== 404) throw new Error(`Cloud Storage delete: ${r.status} ${await r.text()}`);
}

/** V4 signed GET link, valid for `seconds` (max 7 days). */
export async function signedUrl(bucket: string, object: string, seconds = 3600, filename?: string, now = new Date()) {
  const sa = env.sa();
  const date = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const stamp = `${date}T${now.toISOString().replace(/[-:]/g, "").slice(9, 15)}Z`;
  const scope = `${date}/auto/storage/goog4_request`;
  const path = `/${bucket}/${object.split("/").map(rfc3986).join("/")}`;
  const q: Record<string, string> = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256", "X-Goog-Credential": `${sa.client_email}/${scope}`,
    "X-Goog-Date": stamp, "X-Goog-Expires": String(seconds), "X-Goog-SignedHeaders": "host",
  };
  if (filename) q["response-content-disposition"] = `inline; filename="${filename.replace(/"/g, "")}"`;
  const qs = Object.keys(q).sort().map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`).join("&");
  const canonical = ["GET", path, qs, "host:storage.googleapis.com\n", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["GOOG4-RSA-SHA256", stamp, scope, hex(await crypto.subtle.digest("SHA-256", enc.encode(canonical)))].join("\n");
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await rsaKey(sa.private_key), enc.encode(toSign));
  return `https://storage.googleapis.com${path}?${qs}&X-Goog-Signature=${hex(sig)}`;
}

/** Run the processing job once, with these environment values. Returns the execution name. */
export async function runJob(vars: Record<string, string>) {
  const url = `https://run.googleapis.com/v2/projects/${env.project()}/locations/${env.region()}/jobs/${env.job()}:run`;
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ overrides: { containerOverrides: [{ env: Object.entries(vars).map(([name, value]) => ({ name, value })) }] } }),
  });
  if (!r.ok) throw new Error(`Cloud Run: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j?.metadata?.name ?? j?.name ?? "";
}

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
