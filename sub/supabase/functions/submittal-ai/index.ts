// =============================================================================
//  submittal-ai — Supabase Edge Function
//  A. Weiss project dashboard · updated 02.11.2026 (fill: 24k room, keeps finished products, logs stop reason)
// =============================================================================
//
//  One function, seven jobs. The browser decides which by the `mode` field:
//
//    (no mode)  fill ONE submittal form from the documents assigned to it
//    assign     sort a batch of uploaded documents onto the checklist
//    suggest    find the OFFICIAL documents a submittal is missing (web search)
//    classify   read a bill of quantities and route every line
//    rooms      read drawings: task "rows" (room ↔ mark) or "marks" (describe)
//    po         read a purchase order: number, date, supplier, delivery
//    translate  put the form's own words into the other language
//
//  Two rules run through all of them, and they are the whole point:
//
//  1. NOTHING IS INVENTED. A field the source does not state comes back empty.
//     An empty field is a field Marcella fills in herself in ten seconds; an
//     invented one is a wrong order that nobody catches until it arrives.
//  2. THE KEY NEVER LEAVES THE SERVER. The browser sends text and gets JSON.
//
//  Deploy: Supabase → Edge Functions → submittal-ai → paste → Deploy.
//  Secret required: ANTHROPIC_API_KEY.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";
const API = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// Talking to the model.
// -----------------------------------------------------------------------------
let lastStop = "";
let lastUsage: Record<string, unknown> = {};
let lastSources: { url: string; title: string }[] = [];
async function ask(
  key: string,
  system: string,
  content: unknown,
  maxTokens = 4096,
  // Anthropic's own web search. Given here, the model does the searching on
  // Anthropic's side and comes back with an answer that cites real pages —
  // which is the only honest way to recommend a document that exists. Left off
  // for every other job in this file: nothing else may touch the internet.
  webSearch = 0,
  // 08.11.26 — how hard the model thinks before it answers. Left to its
  // default ("high") a fill spent ~10,500 tokens thinking for ~1,200 of
  // answer: 133 s on 07.11, and over the 150 s the platform allows on 08.11,
  // when the call was cut off and the screen said "not connected".
  effort = "",
): Promise<string> {
  // One user message, and nothing after it. Starting the answer for the model
  // (an "assistant" message carrying the opening brace) is refused outright by
  // this model — "the conversation must end with a user message" — so the way
  // to stop a preamble is to ask for no preamble, in the instructions, and to
  // strip one off if it arrives anyway (see parseJson).
  const messages: unknown[] = [{ role: "user", content }];
  // 08.11.26 — never past the platform's 150 s: at 140 s the call is stopped
  // and the screen is told so in words (a call the platform kills comes back
  // with no answer at all).
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 140_000);
  let res: Response;
  try {
  res = await fetch(API, {
    signal: ctl.signal,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      ...(webSearch
        ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: webSearch }] }
        : {}),
      ...(effort ? { output_config: { effort } } : {}),
    }),
  });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error)?.name === "AbortError") throw new Error("timeout");
    throw e;
  }
  let text = "";
  try { text = await res.text(); } catch (e) {
    clearTimeout(timer);
    if ((e as Error)?.name === "AbortError") throw new Error("timeout");
    throw e;
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`upstream ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  // "max_tokens" here means the answer was cut off mid-sentence. That is the
  // difference between "the model refused" and "we did not give it room", and
  // it is the one thing worth carrying back to the screen.
  lastStop = String(data?.stop_reason || "");
  lastUsage = (data && data.usage) || {};
  // With web search on, the reply is a run of blocks: the searches it ran, the
  // results it got, and the text it wrote. Only the text is the answer — but
  // the pages it actually opened are worth keeping, because a link the model
  // did not really visit is a link that may not exist.
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  lastSources = [];
  blocks.forEach((c) => {
    if (c && c.type === "web_search_tool_result" && Array.isArray(c.content)) {
      c.content.forEach((r: any) => {
        if (r && r.url) lastSources.push({ url: String(r.url), title: String(r.title || "") });
      });
    }
  });
  return blocks.filter((c) => c && c.type === "text").map((c) => c.text || "").join("");
}

// A cut-off answer still holds the products it finished. Walk the "products"
// array and keep every object that closed (02.11.26).
function salvageProducts(raw: string): Record<string, unknown>[] {
  const s = String(raw || "");
  const at = s.indexOf('"products"');
  if (at < 0) return [];
  const open = s.indexOf("[", at);
  if (open < 0) return [];
  const out: Record<string, unknown>[] = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = open + 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(s.slice(start, i + 1))); } catch (_) { /* skip */ }
        start = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}

// The model is asked for JSON and usually gives exactly that, but a stray
// sentence or a ```json fence in front of it must not lose the whole answer.
function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const a = cleaned.indexOf("{");
    if (a < 0) return null;
    const b = cleaned.lastIndexOf("}");
    if (b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch (_e) {
        // fall through to the salvage below
      }
    }
    // An answer that ran out of room ends in the middle of an entry. Everything
    // before the last complete one is still perfectly good, and throwing away
    // seventy classified lines because the seventy-first was cut in half is a
    // poor trade — especially as the caller already knows what to do with a
    // line that came back unanswered.
    //
    // Closing it means CLOSING IT PROPERLY: cut back to the last entry that
    // finished, then shut every bracket that is still open, in the right
    // order. Appending a single "}" only ever worked when the truncation
    // happened to be one level deep, which is why a cut-off submittal came
    // back as "bad_answer" instead of a partly filled form (30.8.26).
    return repairJson(cleaned.slice(a));
  }
}

// Close what the truncation left open. Walks the text with a small stack, so
// strings and escapes cannot be mistaken for structure.
function repairJson(body: string): Record<string, unknown> | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  // The last position at which the document was structurally sound AND an
  // entry had just finished — that is where it is safe to cut.
  let safe = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) stack.pop(); else return null;
      if (stack.length) safe = i;      // an entry inside something else closed
    }
  }
  const close = (upto: number) => {
    const head = body.slice(0, upto + 1);
    // Rebuild the stack for this prefix and shut it.
    const st: string[] = [];
    let q = false;
    let e = false;
    for (let i = 0; i < head.length; i++) {
      const ch = head[i];
      if (q) { if (e) e = false; else if (ch === "\\") e = true; else if (ch === '"') q = false; continue; }
      if (ch === '"') { q = true; continue; }
      if (ch === "{" || ch === "[") st.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") st.pop();
    }
    try {
      return JSON.parse(head + st.reverse().join("")) as Record<string, unknown>;
    } catch (_) {
      return null;
    }
  };
  // Try the whole thing first — it may only be missing its closing brackets.
  const whole = close(body.length - 1);
  if (whole) return whole;
  // Otherwise fall back to the last entry that finished cleanly.
  return safe > 0 ? close(safe) : null;
}

// =============================================================================
//  1. THE SUBMITTAL FORM
// =============================================================================
const FILL_SYSTEM = `You fill in an equipment/material submittal form for a construction project, reading ONLY the specification documents you are given.

WHAT THIS JOB IS (08.11.26) — EXTRACTION, NOT STUDY.
You are NOT asked to learn or summarise the specification. Find these things
and nothing else:
  · what each document IS (its type: datasheet, catalogue, CE certificate,
    Israeli standard certificate, test report, warranty ...)  -> fileNotes
  · the exact, formal name of the product(s) as printed     -> itemDescription
  · the models and catalogue numbers (מק"ט) as printed       -> modelCode / infoHe
  · the manufacturer as printed                             -> manufacturer
  · a two-line brief of what the product is for              -> infoEn / infoHe
  · expiry dates and papers that are missing                 -> checks
Look for them where they are printed (the title, the header, the ordering
table, the certificate's face) and stop. Do not deliberate at length: if a
value is printed, copy it; if it is not, return "".
These fields are NOT yours on this job and come back empty:
subCategory "", conflicts [], boq "", docs {}.

HARD RULES
1. EVERY VALUE MUST HAVE A SOURCE, and the only sources are the documents
   assigned to THIS submittal, the project's own specification, and what the
   system already holds. If they do not state something, return "" for it.
   Never write a plausible value, never complete a partial model number, never
   infer a manufacturer from a product's look, never fill a gap from general
   knowledge, and never from the internet — you are not looking anything up.
   MISSING IS BETTER THAN UNSUPPORTED. An empty field takes ten seconds to
   fill in; a confident wrong one is not caught until the wrong thing arrives.
2. ONE SUBMITTAL IS ONE PRODUCT — AND ONE PRODUCT IS ONE SUBMITTAL, however
   many documents it arrived in. A product normally comes as SEVERAL files: a
   datasheet, a catalogue page, a standard or CE certificate, a test report, an
   EPD, a fire certificate, an acoustic report, a warranty, an installation
   guide. Those are one product and ONE entry, with every one of those file
   names listed in its "files". Never open a second entry because a second file
   arrived. Two entries mean two genuinely different products — a different
   model, a different type mark, a different manufacturer's item — not a
   different document about the same one.
   Where a set of files covers a FAMILY that is approved together (one tile in
   three sizes, one fitting in four diameters), that family is one entry too.
   TREAT THE ASSIGNED DOCUMENTS AS ONE PACKAGE: read across them and
   cross-check them against each other before you write anything.
3. A document that belongs to none of the products is named in "unusedFiles" — never forced into a product.
4. WRITE IN THE READER'S LANGUAGE. The language is given to you below. Hebrew
   means every free-text field comes back in Hebrew — the description, the
   identifier where it is a kind rather than a code, the notes — even when the
   specification itself is in English. A model number, a manufacturer's name and
   a standard's designation stay exactly as printed, in their own alphabet.
   English means the same the other way round.
5. HOW TO WRITE. This form is submitted to a client for approval, so it must
   read as though a professional wrote it — flowing sentences, ordinary
   punctuation, no telegraphic fragments, no bullet-point stubs strung
   together, no repeating the same noun three times in a line. Write plainly
   and continuously.
   Writing well never means writing more, and it never means adding anything.
   Every fact still comes from the documents in front of you: the fluency is in
   the phrasing, not in the content. If the documents are thin, the sentence is
   short — a short honest line reads better than a padded one, and padding is
   how a fact nobody stated ends up on a page somebody signs. The client has
   the full specifications attached and will read them if he wants the detail;
   this form is here to say clearly what is being submitted.
   NO DASHES AS PUNCTUATION. Never join or separate words with a dash (—, –
   or a hyphen with spaces round it). Write the sentence properly instead:
   a comma, a period, "של", "עבור", "הכולל", "דגם". A hyphen INSIDE a model
   number or a code (DS-2CD2143, FL-01) is part of the code and stays.
   LINES. Every sentence of the additional information ends with a period and
   starts on a NEW LINE. A list item is a line of its own. Never break
   a line in the middle of a phrase — a line ends where a sentence or an item
   ends, so the text reads grammatically when it is printed.
6. CHECK THE PAPERS, DO NOT ONLY COPY THEM. Say whether what arrived is fit to
   submit: is there a datasheet at all; is a standard or type certificate
   present; does anything carry an expiry or a valid-until date, and has it
   passed. Put that in "checks".
7. THE REVIEW AND APPROVAL SECTION IS NOT YOURS. Never decide approved,
   approved-as-noted, resubmit or not-approved; never write a signature; never
   write a comment as though the approving authority had written it. That
   section belongs to a person.

FIELDS
typeId           the project's own type mark when one is given to you below,
                 then " | " and the general product name ("FL7A | LVT Flooring");
                 with no type mark, the general product name alone ("מזגן מיני
                 מרכזי"). Never a manufacturer, model or catalogue number here,
                 and never a project identifier you were not given.
itemDescription  WHAT ITEM IS BEING SUBMITTED FOR APPROVAL: THE PRODUCT'S
                 EXACT, FORMAL NAME AS THE MANUFACTURER PRINTS IT (series and
                 product name), then AT MOST TWO details that identify it — the two
                 that matter most to someone recognising it (material and
                 finish, or size and application). Not three, not a list.
                 ONE LINE. Six to twelve words, written as a line somebody
                 would say out loud, not as a string of labels. If a third
                 detail is forming, cut it. Do not copy
                 paragraphs of the specification, do not summarise the whole
                 datasheet, and do not add anything that does not help somebody
                 recognise the product.
modelCode        the model or catalogue number, exactly as printed. Write it
                 whenever the documents give one that identifies the item being
                 submitted — INCLUDING when that item comes in several sizes,
                 lengths, cross-sections or configurations. A model supplied in
                 four widths is still that model, and the number belongs here.
                 Never invent one, never complete a partial one, never infer one.
                 Write "Custom" ONLY when the item genuinely has no model of its
                 own because it is fabricated to this project's dimensions and
                 no catalogue number describes what will actually arrive — a
                 made-to-measure element, a cut-to-opening unit, a
                 built-to-order assembly. "Custom" means this product has no
                 model number, which is a different statement from "a model
                 number was not found".
                 Where BOTH exist — a family, profile or material number, and a
                 made-to-measure element built from it — write the number here
                 and say in the additional information that it is supplied to
                 measure.
                 When the documents carry SEVERAL catalogue numbers that all
                 belong to this same submittal, do not pick one and do not drop
                 the rest: leave this field to the single number if there is
                 one, and list them all in the additional information instead
                 (see infoEn/infoHe below).
manufacturer     the maker's name as printed in the assigned documents. If the
                 documents do not name one, use the SUPPLIER already recorded
                 on this submittal, which is given to you below. Never guess it,
                 never read it off the product's name, never look it up.
infoEn           WHAT THE PRODUCT DOES AND WHAT IT IS FOR — English.
infoHe           the same — Hebrew.
                 A SHORT, FOCUSED BRIEF: AT MOST TWO SENTENCES AND NO MORE THAN
                 THIRTY WORDS. This box is a fixed area on a one-page form and
                 the client's signature sits below it. More importantly, the
                 full specifications are attached for anyone who wants detail:
                 this box is the brief, not the datasheet. Choose the ONE OR
                 TWO facts that matter and leave every other number out —
                 a datasheet is full of technical values that are true and
                 irrelevant here (voltages, IP ratings, temperature ranges,
                 weights, test results, standards lists). Do not tell the
                 story of the product.
                 General information only. What it is for and where it is used,
                 when the documents say so. At most ONE technical value, and
                 only when it is the thing that defines the product.
                 DO NOT go into detail: no parameter lists, no tables of data,
                 no dimensions run through one by one, no ranges, no test
                 values. The full specifications are attached to this submittal
                 and the client reads them when he wants that level — repeating
                 them here costs the page and gains nothing.
                 No marketing, no history of the product category, no
                 description of the manufacturer, no long list of parameters, no
                 storytelling. Where the documents are thin, write one sentence
                 and stop: filling the space is exactly how an unsupported claim
                 gets in.
                 This field must NOT repeat itemDescription: that one says WHAT
                 is being submitted, this one says WHAT IT DOES. They complete
                 each other.
                 When several catalogue numbers belong to this submittal, end
                 with a structured list, after the sentences:
                   "The file includes the following catalogue numbers:"
                   · 123456, 600x600
                   · 123457, 600x1200
                 (every item on a line of its own, no dashes)
                 Give the size, type, model or configuration beside each number
                 when the documents make that relationship clear. Include ONLY
                 numbers that belong to this submittal — never copy every
                 number out of a catalogue full of other products.
pages            the 1-based page numbers this product's information came from
files            the FILE NAMES, exactly as given to you, of every document
                 that belongs to this product — the datasheet and the
                 certificate and the test report together. This is what decides
                 which papers are filed under which submittal.
checks           what you found when you looked at the papers themselves:
                 { "expires": "YYYY-MM-DD" or "",   the earliest expiry or
                                                    valid-until date on any of
                                                    them, "" if none is stated
                   "expired": true/false,           that date has already passed
                   "missing": ["datasheet","certificate"],
                                                    kinds of document a
                                                    submission like this
                                                    normally needs and that are
                                                    NOT among these files
                   "note": "" }                     one short sentence, in the
                                                    reader's language, only if
                                                    something is genuinely wrong
fileNotes        ONE ENTRY PER UPLOADED FILE, at the top level of the answer
                 (not inside a product), in the order the files were given:
                 { "file": the file name exactly as given,
                   "content": what this document IS, read from the document
                              itself, in a few words in the reader's
                              language: "מפרט טכני", "תו תקן ישראלי 1001",
                              "תעודת CE", "דוח בדיקה לעמידות אש",
                              "הצהרת EPD". Give the standard's number or the
                              certificate's subject when it is printed.
                   "validUntil": "YYYY-MM-DD" when the document states an
                              expiry or valid-until date, otherwise "",
                   "expired": true when that date has already passed }
                 Only what the document states. No dashes as punctuation.

Answer with JSON only:
{"products":[{"typeId":"","itemDescription":"","modelCode":"","manufacturer":"","infoEn":"","infoHe":"","subCategory":"","pages":[1,2],"files":["spec.pdf","certificate.pdf"],"boq":"08.01.0020","conflicts":[],"checks":{"expires":"2027-03-01","expired":false,"missing":[],"note":""},"docs":{"datasheet":true,"certificates":true}}],"unusedFiles":["name.pdf"],"fileNotes":[{"file":"spec.pdf","content":"מפרט טכני","validUntil":"","expired":false}]}`;

// 21.10.26 — she says, before every fill, whether the uploaded files are ONE
// PRODUCT or the components of ONE SYSTEM. In system mode the files are not
// split into products: they are read together as one system, and the form
// names the system and lists what each specification stands for.
const SYSTEM_MODE = `

SYSTEM MODE — THIS OVERRIDES RULE 2 AND THE FIELD RULES BELOW WHERE THEY DIFFER.
The person submitting has told you that ALL the uploaded documents are the
components of ONE SYSTEM (for example a CCTV system: cameras, a recorder, a
PoE switch, a monitor, brackets). Return EXACTLY ONE entry in "products", with
EVERY file name in its "files". Never split the system into products.
First work out from the documents themselves what the system is — what the
components have in common and what they serve together. HARD RULE 1 still
holds in full: the system's name, every component and every model come from
what the specifications say, never from what such a system usually contains.
A component no document describes is not listed. Then, for EACH
document, work out which component it describes: the kind of item, and its
model when the document prints one. Several documents about the same
component (a datasheet and its certificate) are one component.
typeId           the project's own identifier when one is given, then the
                 system's general name: "CCTV | מערכת מצלמות במעגל סגור",
                 "Access Control | מערכת בקרת כניסה". Otherwise the system's
                 general name alone. Never a manufacturer or a model.
itemDescription  ONE line: the system, and its main components by kind —
                 "מערכת מצלמות הכוללת מצלמות כיפה, מקליט NVR ומתג PoE".
modelCode        "" unless the whole system is sold under one model number.
manufacturer     the maker when every component is from the same one; when
                 they come from several, their names joined with " / ", in
                 the order the components are listed. Only names printed in
                 the documents.
infoEn / infoHe  ONE or TWO sentences on what the system does and what it
                 serves — then the components, one line each, in this shape
                 (the heading in the reader's language):
                   "The system includes the following components:"
                   · Dome camera 4MP, model DS-2CD2143G2-I
                   · NVR, 16 channels, model DS-7616NI-K2
                   · PoE switch, 8 ports, model DS-3E0510P-E
                 One line per component, not per file. The model as printed;
                 leave it out when the document gives none. The thirty-word
                 limit applies to the sentences only, not to the list.
                 Each component line names the kind and the model, and at
                 most one defining value (4MP, 16 channels) — never more.
docs, checks, conflicts, boq, subCategory: across the whole package, as usual.`;

async function modeFill(key: string, body: Record<string, any>) {
  const specText = String(body.specText || "");
  const images: string[] = Array.isArray(body.images) ? body.images : [];
  if (!specText.trim() && !images.length) return json({ error: "no_spec_text" }, 400);

  const files = Array.isArray(body.files) ? body.files : [];
  const subCategories = Array.isArray(body.subCategories) ? body.subCategories : [];
  // The approvals this discipline is already waiting for. Matching a
  // specification to one of these is what keeps a loaded file on the checklist
  // she already has instead of opening a list of its own (29.8.26).
  const checklist = Array.isArray(body.checklist) ? body.checklist : [];
  const brief = [
    `Reader's language: ${body.lang === "en" ? "English" : "Hebrew"} — write every free-text field in it.`,
    "Everything you write must come from the specifications attached below. Nothing from general knowledge, nothing assumed, nothing added to fill a field.",
    `Today: ${new Date().toISOString().slice(0, 10)} (for judging whether a date has passed)`,
    `Discipline: ${body.category || "(unspecified)"}`,
    `Allowed sub-categories (copy one exactly, or return ""): ${subCategories.join(" | ") || "(none supplied)"}`,
    `Documents: ${files.map((f: any) => f.name).join(", ") || "(unnamed)"}`,
    // The company already on the submittal. When the documents do not name a
    // manufacturer this is what the field falls back to, rather than a guess.
    body.supplier ? `Supplier already recorded on this submittal: ${body.supplier}` : "",
    // What the bill of quantities calls the line this submittal answers: the
    // project's own words for the item, useful for the type identifier.
    body.boqText ? `The bill-of-quantities line this submittal answers: ${body.boqText}` : "",
    body.typeMark ? `The project's own type mark for this item: ${body.typeMark}` : "",
    body.kind === "system"
      ? `THE PERSON SUBMITTING SAYS: these ${files.length} documents are the components of ONE SYSTEM. Follow SYSTEM MODE.`
      : `THE PERSON SUBMITTING SAYS: these ${files.length} documents describe a PRODUCT (or products) — not one system.`,
    // 08.11.26 — no checklist matching on a fill (she does that herself).
  ].filter(Boolean).join("\n");

  // Text when the PDF has a text layer; pictures of the pages when it does not.
  //
  // Five pages, not eight, and thirty thousand characters, not sixty. What a
  // submittal needs is on the first pages and in the specification table; the
  // rest is what made this the slowest job in the file and what pushed the
  // answer past its own ceiling (11.9.26).
  // 21.10.26 — text for the files that have it AND pictures for the ones that
  // do not, in the same request. The browser shares the room out between the
  // files before it sends them, so every file is read, not only the first.
  const content: unknown[] = [{ type: "text", text: brief }];
  if (images.length) {
    images.slice(0, 10).forEach((data) => {
      const m = String(data).match(/^data:(image\/[a-z]+);base64,(.*)$/i);
      if (!m) return;
      content.push({
        type: "image",
        source: { type: "base64", media_type: m[1], data: m[2] },
      });
    });
  }
  if (specText.trim()) {
    content.push({ type: "text", text: `SPECIFICATION TEXT:\n${specText.slice(0, 40000)}` });
  }

  // Room to finish the sentence. At 8192 an answer covering more than one
  // product was cut off mid-JSON and came back as "bad_answer" (11.9.26).
  // 22.10.26 — the rules she taught it, in her own words, on every fill.
  const rules = (Array.isArray(body.rules) ? body.rules : [])
    .map((r: any) => String(r || "").trim()).filter(Boolean).slice(0, 60);
  const RULES = rules.length
    ? `

HER OWN RULES. The person submitting taught you these, one by one. Follow each
of them in every field it concerns. They decide what to choose, how much to
write and how to phrase it; they NEVER permit writing anything the
specifications do not state — HARD RULE 1 wins over every one of them. A rule
that names a discipline or a kind of system applies only there.
${rules.map((r: string) => "- " + r).join("\n")}`
    : "";
  const system = (body.kind === "system" ? FILL_SYSTEM + SYSTEM_MODE : FILL_SYSTEM) + RULES;
  // 02.11.26 — three fills in a row ran ~135 s and came back "bad_answer": the
  // answer reached the 12,000-token ceiling and stopped mid-JSON. Twice the room,
  // and if it is still cut short, every product that WAS finished is kept rather
  // than losing the lot. Whatever happens is written to the log.
  // 08.11.26 — "low": reading what the papers say needs little thinking, and
  // the answer comes in a fraction of the time.
  const raw = await ask(key, system, content, 24000, 0, "low");
  const cut = lastStop === "max_tokens";
  console.log("[submittal-ai] fill", JSON.stringify({ stop: lastStop, usage: lastUsage, chars: raw.length, files: files.length, images: images.length, specChars: specText.length }));
  let out = cut ? null : parseJson(raw);
  if (!out) {
    const saved = salvageProducts(raw);
    if (saved.length) {
      console.warn("[submittal-ai] fill answer incomplete — kept", saved.length, "finished product(s)");
      out = { products: saved, partial: true };
    }
  }
  if (!out) {
    console.error("[submittal-ai] fill bad_answer", lastStop, raw.slice(0, 300), "…", raw.slice(-300));
    return json({
      error: cut
        ? "התשובה ארוכה מדי ונקטעה — נסי לטעון פחות קבצים בבת אחת"
        : `bad_answer (stop_reason: ${lastStop || "unknown"})`,
    }, 502);
  }
  // The browser accepts either one product or a list; hand back the list shape
  // it already knows how to read.
  return json(out);
}

// =============================================================================
//  AI SUGGESTED DOCUMENTS
//
//  Her reasoning guide, §23–28: only AFTER the form has been filled and the
//  package reviewed, and only for the submittal she is standing in. The model
//  is told what the product is and WHAT IS ALREADY THERE, and it looks for the
//  official documents that are missing.
//
//  A suggestion is never part of the submittal. Nothing is downloaded, nothing
//  is attached, and nothing it finds is used to fill a field. She looks, and if
//  it is right she downloads it and uploads it herself — and only then does it
//  become a source (§28).
// =============================================================================
const SUGGEST_SYSTEM = `You are helping a construction submittal. The form has already been filled in
from the documents that were actually submitted. Your job now is ONE thing: find
the OFFICIAL documents about this product that are NOT in the package, and say
where they are.

WHAT TO LOOK FOR
There is no fixed list. Look for what this particular product and this
particular project would genuinely need, and only for what is missing. Depending
on the product that may be: a technical datasheet, a product datasheet, a
product catalogue, a safety data sheet (SDS/MSDS), a declaration of performance,
a CE or type certificate, a standards or compliance certificate, a fire
certificate, an acoustic test report, a test report, an EPD, an HPD, VOC
documentation, LEED or WELL documentation, installation instructions,
maintenance instructions, a warranty.

Do NOT suggest a kind of document this product would not have.
Do NOT suggest something that is ALREADY in the package — you are told what is
there.

WHERE TO LOOK, IN THIS ORDER
1. The manufacturer's own website.
2. The official supplier's or authorised distributor's website.
3. An official certification, testing, standards or environmental database.
4. Another reliable professional source, and ONLY when no official one exists.

HARD RULES
· NEVER invent a URL. Never build one that looks likely. Give only a page you
  actually opened in the search.
· Do not call a document official unless you can see that it is.
· Check the document really is about THIS product — the same model, or at the
  very least the same product series. Say which.
· If you cannot find something for a document type, leave it out. An empty
  answer is a good answer; a wrong link is worse than none.
· Do not describe the manufacturer, do not write marketing, do not summarise
  the product.

ANSWER WITH JSON ONLY, no preamble:
{"suggestions":[{"docType":"Safety Data Sheet","name":"exact title of the document as published","product":"the model or series it covers","why":"one short line, reader's language, saying why this submittal needs it","matchLevel":"exact","source":"Manufacturer","pageUrl":"https://…","fileUrl":"https://…/sds.pdf"}]}

FIELDS
docType     the kind of document, in the reader's language.
name        its published title, as printed on the page. Not invented.
product     the model, or the series, the document covers.
why         one short line: why this submittal is missing it.
matchLevel  "exact"        this document is for this exact model;
            "series"       it covers the product's series or family;
            "manufacturer" it is the manufacturer's general documentation.
source      "Manufacturer" | "Supplier" | "Certification body" | "Other".
pageUrl     the official page where the document can be reached. Required.
fileUrl     the direct link to the file itself when there plainly is one;
            "" when there is not. Never guessed.`;

async function modeSuggest(key: string, body: Record<string, any>) {
  const product = String(body.product || "").trim();
  if (!product) return json({ error: "no_product" }, 400);

  const have: string[] = Array.isArray(body.have) ? body.have.map(String) : [];
  const brief = [
    `Reader's language: ${body.lang === "en" ? "English" : "Hebrew"} — write "docType" and "why" in it.`,
    `Discipline: ${body.category || "(unspecified)"}`,
    `THE PRODUCT: ${product}`,
    body.manufacturer ? `Manufacturer: ${body.manufacturer}` : "",
    body.model ? `Model / catalogue number: ${body.model}` : "",
    body.typeId ? `Type identifier on this project: ${body.typeId}` : "",
    body.info ? `What the submittal says about it: ${String(body.info).slice(0, 1200)}` : "",
    "",
    have.length
      ? `ALREADY IN THE PACKAGE — do not suggest any of these again:\n${have.map((h) => `· ${h}`).join("\n")}`
      : "The package holds no documents of a known kind yet.",
  ].filter(Boolean).join("\n");

  // Web search is switched on for this job and this job only.
  const out = parseJson(await ask(key, SUGGEST_SYSTEM, [{ type: "text", text: brief }], 4096, 6));
  if (!out) return json({ error: "bad_answer" }, 502);

  // A link the model did not actually open is a link that may not exist. Only
  // pages that came back from a real search survive (§26).
  const seen = new Set(lastSources.map((s) => s.url));
  const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch (_) { return ""; } };
  const hosts = new Set(lastSources.map((s) => host(s.url)).filter(Boolean));
  const list = Array.isArray((out as any).suggestions) ? (out as any).suggestions : [];
  const kept = list
    .map((r: any) => ({
      docType: String(r?.docType || "").trim(),
      name: String(r?.name || "").trim(),
      product: String(r?.product || "").trim(),
      why: String(r?.why || "").trim(),
      matchLevel: ["exact", "series", "manufacturer"].indexOf(String(r?.matchLevel)) >= 0
        ? String(r.matchLevel) : "manufacturer",
      source: String(r?.source || "").trim(),
      pageUrl: String(r?.pageUrl || "").trim(),
      fileUrl: String(r?.fileUrl || "").trim(),
      // Whether the page itself came back from a search, or only its host did.
      verified: seen.has(String(r?.pageUrl || "").trim()),
    }))
    .filter((r: any) =>
      r.pageUrl.indexOf("https://") === 0 &&
      // The host has to be one the search actually returned.
      hosts.has(host(r.pageUrl)) &&
      (!r.fileUrl || (r.fileUrl.indexOf("https://") === 0 && hosts.has(host(r.fileUrl)))));

  return json({ suggestions: kept, searched: lastSources.length });
}

// =============================================================================
//  STAGE A — CLASSIFYING AND ASSIGNING UPLOADED DOCUMENTS
//
//  Marcella's reasoning guide, 30.8.2026, is explicit that this is a job on its
//  own and must not be mixed with filling a form:
//
//    "מסמך שמועלה למערכת אינו Submittal בפני עצמו."
//    "אין ליצור Submittal חדש עבור כל קובץ."
//
//  So this mode reads the documents, works out what each one is ABOUT, groups
//  the ones that describe the same product into a single package, and finds the
//  line of the bill of quantities — and through it the submittal — that the
//  package answers. It fills in nothing, it looks nothing up, it invents no
//  item number. What it cannot place with confidence it hands back for her to
//  place, with its reasons.
// =============================================================================
const ASSIGN_SYSTEM = `You are sorting construction submittal documents. You do NOT fill in any form,
you do NOT look anything up, and you do NOT write a description of anything. You
do one job: work out which product each document is about, put the documents
that describe the SAME product together, and say which line of the bill of
quantities that product answers.

WHAT YOU ARE GIVEN
· The documents themselves — as text, or as pictures of their pages.
· THE CHECKLIST: the lines of this project's bill of quantities for this
  discipline that need an approval. Each is an item number and a name. These
  lines are the authority. They already exist and they are already correct.
· For each checklist line, whether a submittal has already been opened on it.

HOW TO THINK

1. READ EVERY FILE FIRST, ALL OF THEM, BEFORE DECIDING ANYTHING.
   A file name is not evidence. "doc1.pdf" and "Cert_2024.pdf" tell you nothing.
   Read the page and understand: what the product IS, what it is made of, what
   equipment or system it belongs to, what it is for, whose it is, which model
   or series, which trade.

2. ONE FILE IS NOT ONE SUBMITTAL.
   A product normally arrives as several documents: a datasheet, a catalogue
   page, a certificate, a test report, an EPD, a fire certificate, an acoustic
   report, installation instructions, a warranty. Those are ONE package.
   Cross-check the documents against each other: the same manufacturer, the
   same model, the same series, the same system, the same technical context
   means the same package. Read the whole batch before you commit.

3. THE BILL OF QUANTITIES IS THE BRIDGE.
   The documents will almost never carry an item number — do not look for one.
   Work from what the product is, to the checklist line that is about that kind
   of product, and take that line's number.

     document → what the product is → the checklist line that covers it → its number

4. MATCH PROFESSIONALLY, NOT BY WORDING.
   The surveyor wrote the checklist and the manufacturer wrote the datasheet.
   They will not use the same words and they do not have to. Weigh: product
   type, product family, trade, material, application, purpose, manufacturer,
   model, series, product code, architectural type or code, finish, colour,
   the dimensions that matter, technical characteristics, standards, the
   headings of the specification, and the technical context as a whole.
   · A type code settles it: "N2XY" on the datasheet and "N2XY" on the line is
     the same product.
   · SIZE NEVER SEPARATES. One line covers a product in every size,
     cross-section, diameter, colour and rating: a datasheet for "N2XY 5x2.5"
     answers "כבלי N2XY"; a 4-inch ball valve answers "מגופים כדוריים".
   · Hebrew singular and plural are one word: כבל/כבלים, מגוף/מגופים,
     דלת/דלתות, גוף תאורה/גופי תאורה.

5. A CHECKLIST LINE IS OFTEN A WHOLE FAMILY.
   Several items of the bill of quantities were consolidated into one line when
   the project was classified, and only one representative number is shown. If
   the product answers any member of that family, it answers that line. Do not
   demand a direct numeric match.

6. THE REVIEW LIST IS A LAST RESORT, NOT A DEFAULT.
   Try properly first. Send a package to review only when:
   · you found the right checklist line but no submittal has been opened on it
     — say so, and give the line: this is a submittal that is probably missing;
   · several lines fit equally well — give them all, do not pick one;
   · nothing on the checklist is the kind of thing this product is — say so,
     and DO NOT invent an item number.

7. NEVER INVENT. No item number that is not on the checklist. No manufacturer
   you did not read. No model you did not read. If you are unsure, say you are
   unsure — that is what "confidence" is for.

ANSWER WITH JSON ONLY, no preamble:
{"packages":[{"files":["datasheet.pdf","cert.pdf"],"product":"short name of the product, reader's language","manufacturer":"","model":"","boq":"08.01.0010","confidence":"high","why":"one short line saying what made the match"}],
 "review":[{"files":["x.pdf"],"product":"short name","reason":"no_submittal_line","boq":"08.05.0020","candidates":[{"code":"08.05.0020"}],"confidence":"medium","why":"one short line"}]}

FIELDS
files        the file names exactly as given to you. Every file you were given
             appears exactly once, in a package or in review — never in both,
             never twice, never dropped.
product      a short professional name for the product the package is about.
             A name, not a description: "N2XY power cable", "מגוף כדורי פליז".
manufacturer only if it is printed in the documents; otherwise "".
model        the model or series if the documents state one; otherwise "".
boq          the checklist item number this package answers, copied exactly.
             In "packages" this is required. In "review" it is the number you
             believe is right when reason is "no_submittal_line" or "several",
             and "" when reason is "no_match".
reason       "no_submittal_line" — the checklist line is right but nothing has
                                   been opened on it yet;
             "several"          — more than one line fits;
             "no_match"         — nothing on the checklist is this kind of thing.
candidates   for "several": every line that fits, as {"code":"…"}.
confidence   "high" | "medium" | "low" — how sure you are of the match.
why          one short line, in the reader's language, saying what decided it.

WHAT YOU MUST NOT DO HERE
· Do not fill in any submittal field — no description, no type identifier, no
  additional information. That is a different job and it happens later.
· Do not search the internet or suggest documents that were not uploaded.
· Do not complete missing information from general knowledge.
· Do not open a package for a document just because it is a separate file.`;

async function modeAssign(key: string, body: Record<string, any>) {
  const specText = String(body.specText || "");
  const images: string[] = Array.isArray(body.images) ? body.images : [];
  if (!specText.trim() && !images.length) return json({ error: "no_spec_text" }, 400);

  const files = Array.isArray(body.files) ? body.files : [];
  const checklist = Array.isArray(body.checklist) ? body.checklist : [];
  if (!checklist.length) return json({ error: "no_checklist" }, 400);

  const brief = [
    `Reader's language: ${body.lang === "en" ? "English" : "Hebrew"} — write "product" and "why" in it.`,
    `Discipline: ${body.category || "(unspecified)"}`,
    `Documents in this batch: ${files.map((f: any) => f.name).join(", ") || "(unnamed)"}`,
    "",
    "THE CHECKLIST — the approvals this discipline owes. Item number, name, and",
    "whether a submittal has already been opened on it:",
    checklist
      .map((c: any) => `${c.code}\t${c.name || ""}\t${c.has ? "[submittal opened]" : "[nothing opened yet]"}`)
      .join("\n"),
  ].filter(Boolean).join("\n");

  const content: unknown[] = [{ type: "text", text: brief }];
  if (images.length) {
    images.slice(0, 12).forEach((data) => {
      const m = String(data).match(/^data:(image\/[a-z]+);base64,(.*)$/i);
      if (!m) return;
      content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    });
    if (specText.trim()) {
      content.push({ type: "text", text: `TEXT FROM THE FILES THAT HAD ANY:\n${specText.slice(0, 40000)}` });
    }
  } else {
    content.push({ type: "text", text: `DOCUMENT TEXT:\n${specText.slice(0, 60000)}` });
  }

  const out = parseJson(await ask(key, ASSIGN_SYSTEM, content, 8192));
  if (!out) return json({ error: "bad_answer" }, 502);
  return json(out);
}

// =============================================================================
//  2. THE BILL OF QUANTITIES
//     Marcella's instruction document of 28.8.2026, in the model's own terms.
// =============================================================================
const CLASSIFY_SYSTEM = `You read lines from a construction bill of quantities and decide, for each one, which of three management boards it belongs on — and, just as importantly, WHICH LINES ARE THE SAME PRODUCT.

The bill of quantities is your source of information. It is NOT the shape of the answer. Do not copy it line by line onto the boards.

=============================================================================
THE THREE BOARDS
=============================================================================
S  SUBMITTAL — WHAT. This material, product or system will need a technical
   submission for approval (manufacturer, model, finish, certificate).
   When in reasonable doubt, prefer S with R over silently leaving it off: a
   missed submittal is discovered on site, months late.
D  SD (shop drawing) — HOW. The contractor, supplier or manufacturer must
   produce project-specific fabrication or installation drawings: dimensions,
   connection details, interfaces, system design. A consultant's drawing
   already existing is NOT a reason for D.
L  LLI — WHEN. This is independently procured and tracked: selection, approval,
   ordering, manufacture, delivery, installation. Ask one question: does this
   need to be managed and chased on its own during the project? Routine
   installation materials, standard infrastructure, labour, testing, services
   and internal components of a parent product do NOT.
X  Long lead — an L item whose approval + manufacture + delivery threatens the
   programme. X implies L.
R  Review required — you could not decide with confidence. Use it. A marked
   line gets a human's eye; a guessed line does not.

A line may carry several letters. A line may carry none — return "".

=============================================================================
PARENT PRODUCTS — the part that matters most
=============================================================================
Several BOQ lines often describe ONE thing that is designed, ordered and
managed as one package. Give every such line the SAME family name in "g".
Lines sharing a family name become ONE record on the boards.

  A door is one product: leaf, frame, hinges, lock, seals, hardware.
  A custom staircase is one product: structure, treads, railings, finishes.
  An electrical panel is one product. Its breakers, relays, contactors and
    meters are NOT separate records.
  A green wall, a BMS, an FTC partition, a special aluminium element — each is
    one complete system.

Write "g" in Hebrew, short and concrete: "דלת D4", "לוח חשמל ראשי",
"כבלי N2XY", "צנרת פלדה", "גריל OD1". USE EXACTLY THE SAME WORDING for every
line of the same family — the wording is what joins them.

THE FAMILY NAME CARRIES NO MEASUREMENTS. Never write a diameter, a
cross-section, a dimension, a length, a weight, a colour or a quantity into
"g". The name is the product; the size is one line of it.
  RIGHT: "כבלי N2XY"          WRONG: "כבל N2XY 5x2.5"
  RIGHT: "מגופים כדוריים"      WRONG: 'מגוף כדורי 2"'
  RIGHT: "מפזר OD1"            WRONG: "מפזר OD1 600/600"
  RIGHT: "צנרת PEX"            WRONG: 'צנרת PEX בקוטר 3/4"'
A type or model code is not a measurement and stays: FL-01, D4, OD1, N2XY, W1.

TYPE versus SIZE:
  D4, D5, M1, M2, M3 are different door TYPES → different families.
  WB1, WB2, WB3 are different whiteboard types → different families.
  OD1 in four sizes is ONE family. A size is not a new product.
  Steel pipe in eight diameters is ONE family.
  Ball valves in six diameters are ONE family. Cable of one type in five
  cross-sections is ONE family. Twenty lines, one record.

"m" — THE NUMBER THAT HOLDS THE PRODUCT TOGETHER. Every single line of one
parent product carries the SAME "m": the item number of the line that best
represents the product (the main item, never an accessory). This holds across
sub-chapters AND across chapters — a staircase priced partly under concrete and
partly under metalwork is ONE product, and what says so is that every one of its
lines carries the same "m".
  A staircase: structure, treads, risers, stringers, railing, handrail, coating
  and finish are ONE record. One "g", one "m", on all of them.
  An electrical panel: the panel, its breakers, its relays, its meters, its
  busbars — one "g", one "m".
Leave "m" empty only for a line that stands entirely alone.

INSIDE, NOT BESIDE. A component, accessory, fitting, support, bracket, hanger,
connector, consumable, spare or test that belongs to a parent product is part of
that parent: give it the parent's "g" and the parent's "m", and give it NO
LETTERS ("f": ""). It must not become a record of its own, and it must not add a
second tick beside the parent. Only the lines that describe the product itself
carry letters — and where one record is enough, ONE line carries them.

NO DUPLICATES: supply and installation of the same product are one family, not
two. The same product mentioned again under testing, integration or connection
is the same family.

=============================================================================
DISCIPLINE ("c")
=============================================================================
Choose from exactly these, by what the item IS — never by its chapter number,
which is only a local numbering convention and differs between projects:
  architecture · flooring · cladding · ceiling · electrical · lighting · hvac ·
  plumbing · joinery
"cladding" is the finishes folder. "joinery" is carpentry and built-in
furniture — cupboards, counters, worktops, shelving, wooden doors, timber
cladding, ironmongery: it lives on the LLI and SD boards and never carries S,
because carpentry is approved by a shop drawing, not by a material sheet.
"architecture" takes architectural products that belong to none of the others.
Unsure: leave "c" empty.

=============================================================================
PROFESSIONAL RULES  (S = submittal, D = shop drawing, L = LLI)
=============================================================================
Concrete cast on site .................... none
Special precast / factory concrete ....... L, D where applicable
Waterproofing ............................ S only
Doors, each type ......................... L D   (NOT S)
Custom staircases ........................ L D   (NOT S)
Whiteboards, independent arch. products .. L S
Sprinklers, HVAC drainage ................ S only
Water pipes and accessories .............. S only
Pumps, filtration, softeners, tanks ...... L S
Firefighting and hydrants ................ S only
Sanitary fixtures, each type ............. L S
Green wall (one system) .................. L D   (NOT S)
Acoustic pipe insulation ................. S only
Cables, trays, conduits, infrastructure .. S only
Testing, general, points, service,
  warranty, documentation ................ none
DALI control system ...................... L   (the SYSTEM only)
DALI cabling ............................. not L. A DALI-compatible fitting is
                                           not the DALI system.
Lighting fixtures, each type ............. L S
Fire detection / suppression equipment ... S only
Public address equipment ................. S only
Electrical panels, each panel ............ L D   (one parent product; if priced
                                           in m², the m² is NOT a panel count)
BMS ...................................... L (one system record) + D (one
                                           drawing) + S on its equipment.
                                           Sensors and accessories: S only.
Flooring and cladding, each type ......... L S   (identify FL, FN, CL codes;
                                           material/model/series/colour/finish
                                           differences make separate types)
Adhesive, grout, levelling ............... not L
Profiles (one general family) ............ L S   (not one per section or size)
Skirting / panels, each product type ..... L S
Colours and finishes, each specification . L S   (throughout the whole BOQ, not
                                           only in painting sections: FL, FN,
                                           CL, RAL, NCS, "colour by architect",
                                           material, texture, special finish. A
                                           finish is not skipped because the
                                           manufacturer is not chosen yet.)
FTC partitions ........................... L D   (NOT S)
Aluminium doors, each type ............... L D   (NOT S)
Special aluminium elements ............... L D   (NOT S)
Air conditioning units ................... L (ONE family for all units) +
                                           S (one consolidated submittal)
HVAC pipes, accessories, insulation ...... S only
Measuring instruments (gauges etc.) ...... S only
Visible grilles / air distribution ....... L S   (same type, different sizes =
                                           one family)
HVAC control system ...................... L (one system) + S (one submittal)
Ceilings, each type ...................... L S
Curtains and shading, each type .......... L S
Other finished architectural products .... L S
Standard gypsum work, installation goods . not L
Signage, each type ....................... L D   (NOT S; do not split into
                                           anchors, frame, internal lighting)
Carpentry and metalwork, each item ....... L D   (NOT S; CW01, CW02 … each its
                                           own family. Hardware, tracks,
                                           shelves stay inside the parent)
Demolition, removal, labour, dayworks,
  services, execution-only activities .... none

=============================================================================
ANSWER
=============================================================================
JSON only, one entry per item number you were given, nothing else:
{"08.11.0010":{"f":"LDX","g":"לוח חשמל ראשי","c":"electrical","m":"08.11.0010"},
 "08.11.0020":{"f":"","g":"לוח חשמל ראשי","c":"electrical","m":"08.11.0010","a":1}}

"f" holds the letters S D L X R in any order, or "" for a line that belongs on
no board. Give every item number back, even the ones with "".

"a" — set "a":1 when this line is a COMPONENT of the parent rather than the
product itself: a breaker inside the panel, a handle on the door, a fitting or
a support on the pipe, a shelf inside the cupboard, a cable lug, a consumable.
Leave "a" out when the line IS the product, only in another size, diameter or
cross-section — the 30/60 tile beside the 60/60 tile, the 1" valve beside the
2" valve. Both kinds share the family and the "m"; the difference is only that
a component's quantity is not a quantity of the product. Getting this right is
what makes the board say "1 לוח חשמל" instead of "124 יח'".

Your entire reply is that JSON object and nothing else. The first character you
write is "{" and the last is "}". No sentence before it, no explanation after
it, no markdown fence, no notes about what you did or why. Every word spent
outside the JSON is a line of the bill of quantities that does not fit in the
answer.`;

// Ask about a batch, and if the answer comes back cut off, ask about half of it
// — twice — and put the two halves together.
//
// A fixed batch size is a guess about how much a model will say, and a guess
// like that is wrong the first time a bill of quantities has unusually wordy
// lines in it. Halving on failure is not a guess: it is the same work, asked in
// a way that fits, and it costs nothing on the batches that were fine.
async function classifyLines(
  key: string,
  lines: any[],
  depth = 0,
  known: string[] = [],
): Promise<Record<string, unknown> | null> {
  const payload = lines
    .map((r: any) =>
      [r.code, r.sub ? `[${r.sub}]` : "", r.text || "", r.unit ? `(${r.unit}${r.qty != null ? ` ${r.qty}` : ""})` : ""]
        .filter(Boolean)
        .join(" ")
    )
    .join("\n");

  // A bill of quantities is answered a batch at a time, and the model cannot
  // see what it called things in the batch before. Left to itself it writes
  // "כבלי N2XY" in one batch and "כבל N2XY" in the next, and one product
  // becomes two records. So the names it has already used are handed back to
  // it, with one instruction: if a line belongs to one of these, reuse the
  // name letter for letter (29.8.26).
  const seen = known.filter((s) => typeof s === "string" && s.trim()).slice(0, 400);
  const head = seen.length
    ? `FAMILY NAMES ALREADY IN USE IN THIS BILL OF QUANTITIES — if a line below belongs to one of these products, copy its name into "g" exactly as written here, character for character. Only invent a new name for a product that is not in this list:\n${seen.map((s) => `· ${s}`).join("\n")}\n\n`
    : "";

  let raw = "";
  try {
    raw = await ask(
      key,
      CLASSIFY_SYSTEM,
      [{ type: "text", text: `${head}BOQ LINES:\n${payload}` }],
      8000,
    );
  } catch (e) {
    if (depth >= 3 || lines.length < 2) throw e;
    raw = "";
  }
  const cutShort = lastStop === "max_tokens";
  const out = raw ? parseJson(raw) : null;

  // Good answer, and complete: done.
  if (out && !cutShort) return out;

  // Too big to answer in one go. Split, and keep whatever the truncated answer
  // did manage to say as a starting point.
  if (lines.length > 1 && depth < 4) {
    const mid = Math.ceil(lines.length / 2);
    const a = await classifyLines(key, lines.slice(0, mid), depth + 1, known);
    // The second half is told what the first half just named, for the same
    // reason the caller tells us what earlier batches named.
    const named = a ? Object.values(a).map((v: any) => (v && typeof v === "object" ? String(v.g || "") : "")).filter(Boolean) : [];
    const b = await classifyLines(key, lines.slice(mid), depth + 1, known.concat(named));
    if (!a && !b) return out;
    return { ...(out || {}), ...(a || {}), ...(b || {}) };
  }
  return out;
}

async function modeClassify(key: string, body: Record<string, any>) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return json({ error: "no_lines" }, 400);

  // The names earlier batches of this same workbook already used.
  const known = Array.isArray(body.known) ? body.known.map((s: unknown) => String(s || "")) : [];
  const out = await classifyLines(key, lines, 0, known);
  if (!out) {
    return json({
      error: lastStop === "max_tokens"
        ? "the model's answer was cut off even on a single line — the batch cannot be made smaller"
        : `the model did not answer in JSON (stop_reason: ${lastStop || "unknown"})`
    }, 502);
  }

  // Hand back only what was asked about, in the shape the browser parses. A
  // line the model dropped is left out on purpose: the browser has its own
  // fallback for a missing answer and it is more generous than a guess here.
  const flags: Record<string, unknown> = {};
  for (const r of lines) {
    const v = (out as any)[r.code];
    if (v == null) continue;
    if (typeof v === "string") flags[r.code] = v;
    else {
      flags[r.code] = {
        f: String(v.f ?? ""),
        g: String(v.g ?? "").trim(),
        c: String(v.c ?? "").trim().toLowerCase(),
        m: String(v.m ?? "").trim(),
      };
    }
  }
  return json({ flags });
}

// =============================================================================
//  3. THE DRAWINGS
// =============================================================================
const ROWS_SYSTEM = `You are given text pulled out of architectural drawings. Find every pairing of a ROOM NUMBER with a SPECIFICATION MARK that appears in that room.

A mark is a short code such as FL-02, CL3, OD1, LF4, CW01, AC2. A room number is usually three digits, sometimes with a letter.

Report only pairings the text actually supports. Do not spread a mark across rooms because it seems likely, and do not invent room numbers.

"cat" is one of: flooring, cladding, ceiling, lighting, grille, hvac, carpentry — or "" when you cannot tell.

JSON only: {"rows":[{"room":"214","mark":"FL-02","cat":"flooring"}]}`;

const MARKS_SYSTEM = `You are given specification marks from a construction project's drawings. For each one give a short professional name and a one-line description of what that kind of element is.

These are generic professional descriptions, not claims about this project. Do not invent a manufacturer, a model, a colour or a dimension — none of that is in front of you. Keep both fields in Hebrew.

JSON only: {"marks":{"FL-02":{"cat":"flooring","name":"ריצוף גרניט פורצלן","desc":"אריח גרניט פורצלן, גוון ומידות לפי רשימת האיפיונים"}}}`;

async function modeRooms(key: string, body: Record<string, any>) {
  const task = String(body.task || "");
  if (task === "rows") {
    const text = String(body.text || "");
    if (!text.trim()) return json({ error: "no_text" }, 400);
    const out = parseJson(await ask(key, ROWS_SYSTEM, [{ type: "text", text: text.slice(0, 90000) }], 8192));
    if (!out || !Array.isArray((out as any).rows)) return json({ error: "bad_answer" }, 502);
    return json({ rows: (out as any).rows });
  }
  if (task === "marks") {
    const marks = Array.isArray(body.marks) ? body.marks : [];
    if (!marks.length) return json({ error: "no_marks" }, 400);
    const list = marks.map((m: any) => `${m.mark}${m.cat ? ` (${m.cat})` : ""}`).join("\n");
    const out = parseJson(await ask(key, MARKS_SYSTEM, [{ type: "text", text: `MARKS:\n${list}` }], 8192));
    if (!out || typeof (out as any).marks !== "object") return json({ error: "bad_answer" }, 502);
    return json({ marks: (out as any).marks });
  }
  return json({ error: "unknown_task" }, 400);
}

// =============================================================================
//  4. THE PURCHASE ORDER
// =============================================================================
const PO_SYSTEM = `You are given a purchase order — as text, or as pictures of its pages when the file had no text in it. Return only the facts that are plainly written in it.

number    the purchase order's own number
date      the date the order was issued, as YYYY-MM-DD
supplier  the company the order is placed WITH — the one that will deliver.
          Not the buyer, not the project, not the manufacturer of the goods.
delivery  the promised delivery date, as YYYY-MM-DD. LOOK FOR THE WORD
          "אספקה" (or "delivery", "מועד אספקה", "זמן אספקה") and take the date
          written beside it. On these orders it is almost always in the notes at
          the FOOT of the page, not in the header with the order date. If two
          delivery dates are given, return the EARLIER one. If the only thing
          stated is a lead time in weeks and no date, return "".
qty       HOW MANY UNITS the order places — the quantity column, not a price
          and not a total. If the order lists several lines, give the quantity
          of the main item it is for. A number only, with no currency and no
          unit. Nothing stated: ""

A field the document does not state comes back as "". Never guess a number, and
never build a date out of a partial one. A date written 05/09/2026 in a Hebrew
or European document is 5 September, not 9 May.

JSON only: {"po":{"number":"","date":"","supplier":"","delivery":"","qty":""}}`;

async function modePo(key: string, body: Record<string, any>) {
  const text = String(body.text || "");
  const images: string[] = Array.isArray(body.images) ? body.images : [];
  // A purchase order is very often a scan or an export with no text layer at
  // all — which is exactly the file that used to come back "no_text" and leave
  // her filling the number, the date and the delivery by hand. When there is no
  // text, the pages are sent as pictures, the same way a specification is
  // (29.8.26).
  if (!text.trim() && !images.length) return json({ error: "no_text" }, 400);
  const content: unknown[] = [];
  if (text.trim()) {
    content.push({ type: "text", text: `PURCHASE ORDER:\n${text.slice(0, 20000)}` });
  }
  let dropped = 0;
  images.slice(0, 6).forEach((data) => {
    const m = String(data).match(/^data:(image\/[a-z]+);base64,(.*)$/i);
    // A picture in any other shape is NOT quietly ignored: that is how a
    // scanned order came back empty with nothing to show for it (29.8.26).
    if (!m) { dropped++; return; }
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  });
  if (!content.length) return json({ error: dropped ? "no_readable_images" : "no_text" }, 400);
  const out = parseJson(await ask(key, PO_SYSTEM, content, 1024));
  const po = out && (out as any).po;
  if (!po) return json({ error: "bad_answer" }, 502);
  return json({
    po: {
      number: String(po.number || "").trim(),
      date: String(po.date || "").trim(),
      supplier: String(po.supplier || "").trim(),
      delivery: String(po.delivery || "").trim(),
      qty: String(po.qty == null ? "" : po.qty).trim(),
    },
  });
}


// =============================================================================
//  5. THE SAME FORM, IN THE OTHER LANGUAGE
//
//  The form is filled once, in one language, and then corrected by hand. What
//  goes to the client must be the corrected text — not what the model wrote
//  first — so the translation happens on demand, from whatever is on the screen
//  at that moment, and she sees the result before anything is sent.
//
//  Nothing here is re-read from the specifications and nothing new is added: a
//  translation that knows more than its source is not a translation. (11.9.26)
// =============================================================================
const TRANSLATE_SYSTEM = `You translate the free-text fields of a construction submittal form between Hebrew and English. You are translating, not writing: every fact in your answer must be in the text you were given, and nothing may be added, explained, expanded or improved.

WHAT STAYS EXACTLY AS IT IS, in its own characters:
· model and catalogue numbers — N2XY, FL-01, SCH-40, EN125D, L.01
· project type marks and architectural codes — FL7A, CL1, CW3, WB2, D4, OD1
· manufacturers' and brands' names
· standards and their designations — EN 1234, ISO 9001, ת"י 1045
· dimensions, quantities, units and percentages — 600x600, 2.5mm, 3/4", 12V
· the word "Custom"
A code is not a word. "נגרות CW3" becomes "Carpentry CW3": the word is
translated, the code is untouched. If you are not certain whether something is
a code or a word, leave it as it is — an untranslated word is a small blemish,
a mangled catalogue number is a wrong order.

HOW TO WRITE THE TRANSLATION
Professional construction language, the way a specifier writes it in the target
language — not word by word. Keep the length: a one-line description stays one
line, three sentences stay three sentences. Do not tidy, do not summarise, do
not add a clause that explains something the original left unsaid.

A field that arrives empty comes back empty. Never fill one in.

Answer with JSON only, no preamble, using exactly the keys you were given:
{"fields":{"typeId":"","itemDescription":"","info":""}}`;

// =============================================================================
//  TEACH (22.10.26)
//
//  A conversation in which she tells the model how she wants submittals
//  written. It answers briefly and turns each instruction into a short rule she
//  can keep; the rules she keeps are sent with every fill from then on.
// =============================================================================
const TEACH_SYSTEM = `You help Marcella, who manages construction submittals, teach the AI that fills in her submittal forms from specification documents.
She writes to you in Hebrew, conversationally. Your job:
1. Understand what she wants changed in how the forms are filled — which field, what to include or leave out, how long, what wording, for which discipline or kind of system.
2. Answer briefly in Hebrew (one to three sentences), saying what you understood. Ask one short question only when the instruction is genuinely unclear.
3. Turn each instruction into a RULE: one short, clear imperative line in Hebrew that the form-filling AI will follow. Name the field ("תיאור הפריט", "מידע נוסף", "איפיון", "דגם", "יצרן") and the discipline or system when she gave one. No dashes as punctuation.
4. Never write a rule that would make the AI state something the specifications do not say: every value on the form must come from the specifications. If she asks for that, explain it kindly in one sentence and offer the nearest rule that keeps to the documents.
5. When she talks about "this" form or field, she means the submittal shown below; the rule you write must still be general, never this product's values.
6. Do not repeat a rule she already has (her current rules are listed below); if a new instruction changes one, propose the replacement and say which one it replaces.
Answer with JSON only:
{"reply":"","rules":["..."]}
"rules" is [] when there is nothing to keep yet.`;

async function modeTeach(key: string, body: Record<string, any>) {
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-20);
  const have = (Array.isArray(body.rules) ? body.rules : []).map((r: any) => String(r || "").trim()).filter(Boolean);
  const transcript = msgs.map((m: any) => `${m.role === "assistant" ? "AI" : "MARCELLA"}: ${String(m.text || "")}`).join("\n\n");
  // The submittal she has open while she talks, so "this description" means
  // something (22.10.26).
  const c = body.context || null;
  const ctx = c ? `THE SUBMITTAL SHE HAS OPEN (discipline ${c.category || "?"}):\nType mark: ${c.typeId || ""}\nItem description: ${c.itemDescription || ""}\nModel: ${c.modelCode || ""}\nManufacturer: ${c.manufacturer || ""}\nAdditional information: ${c.info || ""}\n\n` : "";
  const brief = `${ctx}HER CURRENT RULES:\n${have.length ? have.map((r: string) => "- " + r).join("\n") : "(none yet)"}\n\nTHE CONVERSATION SO FAR:\n${transcript}`;
  const out = parseJson(await ask(key, TEACH_SYSTEM, [{ type: "text", text: brief }], 2048));
  if (!out) return json({ error: "bad_answer" }, 502);
  return json(out);
}

// =============================================================================
//  CHECK AGAINST THE BILL OF QUANTITIES (22.10.26)
//
//  The requirements written in the BOQ line this submittal answers, one by one,
//  against what the specifications say. Nothing is changed on the form: she
//  gets a short list of what to look at before it goes out.
// =============================================================================
const BOQ_CHECK_SYSTEM = `You compare a construction product, as described by its specification documents, against the bill-of-quantities line it is being submitted for.
1. From the BILL-OF-QUANTITIES LINE ONLY, list the concrete requirements it states: a rating (IP65), a value (3000K, 12W, 60x60), a material, a finish, a standard, a function (DALI dimming), a fire rating. Not the product's general name. If the line states no concrete requirement, return no items.
2. For each requirement, find what the SPECIFICATIONS say about the same property:
   "ok"      — the specifications meet it,
   "diff"    — the specifications state something different,
   "missing" — the specifications do not mention it.
   Quote the specification's value briefly, as printed. Never assume, never infer from the product type, never use general knowledge: a property the documents do not state is "missing".
3. Write in Hebrew, short, no dashes as punctuation. Model numbers and units stay as printed.
Answer with JSON only:
{"items":[{"req":"","spec":"","status":"ok|diff|missing"}],"summary":""}
"summary" is one short Hebrew sentence.`;

async function modeBoqCheck(key: string, body: Record<string, any>) {
  const line = String(body.boqText || "").trim();
  if (!line) return json({ error: "no_boq_line" }, 400);
  const specText = String(body.specText || "");
  const images: string[] = Array.isArray(body.images) ? body.images : [];
  const f = body.form || {};
  const content: unknown[] = [{
    type: "text",
    text: [
      `BILL-OF-QUANTITIES LINE${body.boqCode ? " " + body.boqCode : ""}: ${line}`,
      `THE FORM AS FILLED (for orientation only; judge against the specifications): ${[f.typeId, f.itemDescription, f.modelCode, f.manufacturer].filter(Boolean).join(" | ")}`,
    ].join("\n"),
  }];
  images.slice(0, 10).forEach((data) => {
    const m = String(data).match(/^data:(image\/[a-z]+);base64,(.*)$/i);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  });
  if (specText.trim()) content.push({ type: "text", text: `SPECIFICATION TEXT:\n${specText.slice(0, 40000)}` });
  const out = parseJson(await ask(key, BOQ_CHECK_SYSTEM, content, 2048));
  if (!out) return json({ error: "bad_answer" }, 502);
  return json(out);
}

// =============================================================================
//  LEARN FROM HER CORRECTIONS (22.10.26)
//
//  What the AI filled, next to what she sent. Most corrections fix a fact about
//  one product and teach nothing; a few show how she wants every form written.
//  Only those become proposed rules.
// =============================================================================
const LEARN_SYSTEM = `You look at how Marcella corrected a submittal form that an AI had filled from specification documents, and work out whether her corrections show a GENERAL preference about how forms should be written.
For each field you get what the AI wrote and what she kept.
- A correction that only fixes a fact about this one product (a different model number, a different maker, a typo) teaches nothing general: ignore it.
- A correction that changes HOW the field is written — shorter, a different order, a word she always uses or never uses, a detail she always removes or adds, a different way of naming the system — is a preference.
Propose at most TWO rules, each one short clear imperative line in Hebrew naming the field, written so that it applies to future forms, never mentioning this product's specific values. No dashes as punctuation. Do not propose a rule she already has (listed below), and never a rule that would make the AI state anything the specifications do not say.
When nothing general can be learned, return no rules.
Answer with JSON only:
{"rules":["..."],"why":""}
"why" is one short Hebrew sentence explaining what you noticed, or "" when there are no rules.`;

async function modeLearn(key: string, body: Record<string, any>) {
  const pairs = (Array.isArray(body.pairs) ? body.pairs : []).slice(0, 8);
  if (!pairs.length) return json({ rules: [], why: "" });
  const have = (Array.isArray(body.rules) ? body.rules : []).map((r: any) => String(r || "").trim()).filter(Boolean);
  const brief = [
    `HER CURRENT RULES:\n${have.length ? have.map((r: string) => "- " + r).join("\n") : "(none)"}`,
    body.category ? `DISCIPLINE: ${body.category}` : "",
    "THE CORRECTIONS:",
    ...pairs.map((p: any) => `FIELD ${p.field}\n  AI WROTE: ${String(p.ai || "")}\n  SHE KEPT: ${String(p.final || "")}`),
  ].filter(Boolean).join("\n\n");
  const out = parseJson(await ask(key, LEARN_SYSTEM, [{ type: "text", text: brief }], 1024));
  if (!out) return json({ error: "bad_answer" }, 502);
  return json(out);
}

async function modeTranslate(key: string, body: Record<string, any>) {
  const fields = (body.fields && typeof body.fields === "object") ? body.fields : {};
  const keys = Object.keys(fields).filter((k) => String(fields[k] || "").trim());
  if (!keys.length) return json({ fields: {} });

  const to = String(body.to || "en") === "he" ? "Hebrew" : "English";
  const from = to === "Hebrew" ? "English" : "Hebrew";
  const brief = [
    `Translate from ${from} into ${to}.`,
    body.category ? `Discipline: ${body.category}` : "",
    "",
    "THE FIELDS, as JSON. Return the same keys, translated:",
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, String(fields[k] || "")])), null, 1),
  ].filter(Boolean).join("\n");

  const out = parseJson(await ask(key, TRANSLATE_SYSTEM, [{ type: "text", text: brief }], 4096));
  const got = out && (out as any).fields;
  if (!got || typeof got !== "object") return json({ error: "bad_answer" }, 502);
  // Only the keys that were asked about, and only as text. A field the model
  // decided to invent is dropped rather than carried into her form.
  const clean: Record<string, string> = {};
  keys.forEach((k) => { clean[k] = String((got as any)[k] ?? "").trim(); });
  return json({ fields: clean });
}

// =============================================================================
//  THE DOOR
// =============================================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // A function without this check is a public URL anyone can run up a bill on.
    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "unauthorized" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: auth } } },
    );
    const { data: who } = await supabase.auth.getUser();
    if (!who?.user) return json({ error: "unauthorized" }, 401);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);

    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "");

    // Stage A and stage B are different jobs and are asked for separately:
    // sorting documents onto the checklist, and filling one submittal in
    // (Marcella's reasoning guide, 30.8.26).
    if (mode === "assign") return await modeAssign(key, body);
    if (mode === "suggest") return await modeSuggest(key, body);
    if (mode === "classify") return await modeClassify(key, body);
    if (mode === "rooms") return await modeRooms(key, body);
    if (mode === "po") return await modePo(key, body);
    if (mode === "translate") return await modeTranslate(key, body);
    if (mode === "teach") return await modeTeach(key, body);
    if (mode === "boqcheck") return await modeBoqCheck(key, body);
    if (mode === "learn") return await modeLearn(key, body);
    return await modeFill(key, body);
  } catch (e) {
    console.error("[submittal-ai]", e);
    const msg = String((e as Error)?.message || e);
    return json({ error: msg }, msg === "timeout" ? 504 : 500);
  }
});