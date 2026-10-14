// ---------------------------------------------------------------------------
//  t-signcss.mjs — the signing screen's look travels with the signing screen.
//
//  The dashboard and Supervision/index-supervisor.html render the same
//  component out of sign.js. Until 15.9.26 its CSS lived only in the
//  dashboard, so the supervision page would have rendered it unstyled — and
//  nothing would have said so. This test fails if a class the screen renders
//  has no rule in signCss, or if a rule that belongs to the screen is left
//  behind in a dashboard stylesheet the supervision page never loads.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

const sign = readFileSync("sign.js", "utf8");
const html = readFileSync("index.html", "utf8");
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log("  FAIL  " + msg); } };

const MOD = new Set(["on","noting","editing","small","muted","start","end","noBack","go","placing","ready","open","primary"]);

// ---- what the screen renders ---------------------------------------------
const rendered = new Set();
for (const m of sign.matchAll(/className: *(?:"([^"]*)"|`([^`]*)`)/g)) {
  if (m[1] !== undefined) { for (const t of m[1].split(/\s+/)) if (t) rendered.add(t); }
  else {
    for (const part of m[2].split(/\$\{[^}]*\}/)) for (const t of part.split(/\s+/)) if (t) rendered.add(t);
    for (const e of m[2].matchAll(/\$\{([^}]*)\}/g))
      for (const q of e[1].matchAll(/"([^"]*)"|'([^']*)'/g))
        for (const t of (q[1] ?? q[2]).split(/\s+/)) if (MOD.has(t)) rendered.add(t);
  }
}
ok(rendered.size > 40, `sign.js renders ${rendered.size} classes`);

// ---- signCss --------------------------------------------------------------
const m = sign.match(/var signCss = `([\s\S]*?)`;/);
ok(!!m, "sign.js defines signCss");
const css = m ? m[1] : "";
ok(/export \{[\s\S]*?\bsignCss\b[\s\S]*?\};/.test(sign), "sign.js exports signCss");
let depth = 0, under = false;
for (const c of css) { if (c === "{") depth++; else if (c === "}") { if (--depth < 0) under = true; } }
ok(depth === 0 && !under, `signCss braces balance (ends at depth ${depth})`);
ok(!css.includes("`") && !css.includes("${"), "signCss contains nothing that breaks its template literal");

// ---- the dashboard loads it ----------------------------------------------
ok(/\bsignCss\b[^}]*\} from "\.\/sign\.js";/.test(html), "index.html imports signCss from ./sign.js");
ok(/var styles = \[[\s\S]*?\bsignCss\b[\s\S]*?\]\.join/.test(html), "index.html puts signCss in the styles array");

// ---- every rendered class is styled here ---------------------------------
// Comments are stripped first: "(7.9.26)" inside one reads as a class ".9".
const sels = t => [...t.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/([^{}]+)\{[^{}]*\}/g)].map(x => x[1]);
const cssSel = sels(css).join(" | ");
for (const c of [...rendered].sort()) {
  if (MOD.has(c)) continue;
  ok(new RegExp("\\." + c + "(?![A-Za-z0-9_-])").test(cssSel), `signCss styles .${c}`);
}

// ---- and nothing of the screen is left behind ----------------------------
const chunks = [...html.matchAll(/var (base|header|landing|projectMeta|cards|dataSources|pdfViewer|gantt|drawer|admin|marcella|sdSign) = `([\s\S]*?)\n`;/g)];
ok(chunks.length === 12, `all 12 dashboard style chunks found (${chunks.length})`);
const isOwn = c => /^(sb|sig|printAsk|sg)[A-Z]/.test(c) && rendered.has(c);
for (const [, name, bodyCss] of chunks) {
  for (const sel of sels(bodyCss)) {
    const cls = [...sel.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(x => x[1]);
    const theirs = cls.filter(c => !isOwn(c) && !MOD.has(c));
    ok(!(cls.some(isOwn) && theirs.length === 0),
       `${name} still styles the signing screen: "${sel.trim().replace(/\s+/g," ")}"`);
  }
}

// ---- the four borrowed buttons are gone from sign.js ---------------------
// Comments stripped first: the note explaining the rename names all four.
const code = sign.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
for (const b of ["ghostBtn","functionEditBtn","drawerClose","loginBack"])
  ok(!new RegExp("(?<![A-Za-z0-9_])" + b + "(?![A-Za-z0-9_])").test(code),
     `sign.js no longer borrows .${b} from the dashboard`);

// ---- the dashboard did not lose anything on the way out ------------------
// Nine of the screen's classes (sbField, sbLinkBtn, sbSecBar …) are rendered by
// the dashboard's own submittal form too. They live in signCss now, so this
// only holds while index.html actually loads it — which is the point.
{
  const chunkCss = chunks.map(c => c[2]).join("\n");
  const all = sels(chunkCss + "\n" + css).join(" | ");
  const markup = html.replace(/var (?:base|header|landing|projectMeta|cards|dataSources|pdfViewer|gantt|drawer|admin|marcella|sdSign) = `[\s\S]*?\n`;/g, "");
  // Only the literal parts of a template className are class names. Splitting
  // the whole string on punctuation also harvested the identifiers inside
  // ${...} — secOpen, hits, enLabel — and counted them as classes nobody had
  // styled. (14.10.26)
  const used = new Set();
  const take = (s) => { for (const t of s.split(/\s+/)) if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(t)) used.add(t); };
  for (const m of markup.matchAll(/className: *(?:"([^"]*)"|`([^`]*)`)/g)) {
    if (m[1] !== undefined) { take(m[1]); continue; }
    for (const part of m[2].split(/\$\{[^}]*\}/)) take(part);
    for (const e of m[2].matchAll(/\$\{([^}]*)\}/g))
      for (const q of e[1].matchAll(/"([^"]*)"|'([^']*)'/g)) take(q[1] ?? q[2]);
  }
  let missing = 0;
  for (const c of used)
    if (!new RegExp("\\." + c + "(?![A-Za-z0-9_-])").test(all)) missing++;
  // A class with no rule of its own is normal — some are positioned by inline
  // style. What must not happen is the count growing. 14.10.26: 25 of 884,
  // down from an apparent 90 once ${...} identifiers stopped being counted.
  ok(missing <= 25, `dashboard classes left unstyled: ${missing} (was 25 at build 171)`);
}

// ---- nothing dangles between the two files -------------------------------
// Build 147 was a white screen because a component moved to sign.js and the
// names it needed did not travel with it. Three decidable checks, not a
// scope analysis: what index.html asks sign.js for, sign.js must export;
// what sign.js exports, it must actually declare; and an icon alias left
// behind in index.html must still be imported there.
{
  const exported = (sign.match(/export \{([\s\S]*?)\};/) || [,""])[1]
    .split("\n").map(s => s.trim().replace(/,$/, ""))
    .filter(s => s && !s.startsWith("//"));
  const declared = new Set([...sign.matchAll(/(?:^|[;}])\s*(?:async +)?(?:function|var|const|let|class) +([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  for (const n of exported) ok(declared.has(n), `sign.js exports ${n} but does not declare it`);

  const asked = (html.match(/import \{([\s\S]*?)\} from "\.\/sign\.js";/) || [,""])[1]
    .split("\n").map(s => s.trim().replace(/,$/, ""))
    .filter(s => s && !s.startsWith("//"));
  ok(asked.length > 0, `index.html imports ${asked.length} names from sign.js`);
  for (const n of asked) ok(exported.includes(n), `index.html imports ${n}, which sign.js does not export`);

  const lucide = (html.match(/import \{([\s\S]*?)\} from "lucide-react";/g) || []).join(" ");
  const body = html.replace(/import[\s\S]*?from "[^"]+";/g, "");
  for (const icon of ["DownloadSd","PenLineSd","XSd","MoveSd","CheckSd","StampSd","ArrowLeftSd","ArrowRightSd"])
    if (new RegExp("(?<![\\w$])" + icon + "(?![\\w$])").test(body))
      ok(lucide.includes(icon), `index.html still draws ${icon} but no longer imports it`);
}

// ---- the tokens it depends on are declared, not assumed ------------------
const tokens = [...new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(x => x[1]))].sort();
console.log("\n  signCss needs tokens: " + tokens.map(t => "--" + t).join(" "));

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
