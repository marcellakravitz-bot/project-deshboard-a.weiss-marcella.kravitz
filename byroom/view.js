// =============================================================================
//  byroom/view.js — the client's By Room: view only, mobile first. A. Weiss · By Room
//  byroom build 19 · 14.11.2026
//
//  One copy, used by the phone page opened from a QR code or a link (byroom/index.html)
//  and by the By Room cube for a signed-in client inside the dashboard.
//  There is no button here that changes anything. It shows only what was PUBLISHED.
//
//  Her flow (By Room display spec, 25.10.26):
//    opening screen (logos, project) -> Search by Room | Search by Plan -> Room Card -> item -> close -> back where she was
//
//  It is given an `api`, so it does not care where the data comes from:
//    api.home()            -> { project: {name, accent, clientLogo, brandLogo, categories}, floors: [{floor, rooms:[{n,name}]}] }
//    api.floor(f)          -> { map, rooms: [{n, name, area, items:[{kind, code, name}]}] }
//    api.room(f, n)        -> { room: {n, name, area, items:[{kind, code, name, description, image, supplier, status}]} }
//  Look: the subcontractor app's (her decision, 25.10.26) — the dark bar with the A. Weiss logo, navy accents,
//  pill buttons — with the client's and the supervision company's logos on the opening screen.
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

export const KIND = {
  FL: { he: "ריצוף", en: "Flooring" },
  FN: { he: "חיפוי קירות", en: "Wall finish" },
  CL: { he: "תקרה", en: "Ceiling" },
};
// FL / FN / CL are what the plans call flooring / wall finishes / ceiling; every other category keeps its own key
export const KIND_OF_CAT = { flooring: "FL", cladding: "FN", ceiling: "CL" };
const ORDER = ["FL", "FN", "CL", "lighting"];
const TX = {
  he: {
    byRoom: "חיפוש לפי חדר", byPlan: "חיפוש לפי תוכנית", search: "מספר חדר או שם החדר", floor: "קומה", room: "חדר",
    back: "חזרה", home: "מסך ראשי", showPlan: "הצגה על התוכנית", none: "לא הוגדרו איפיונים לחדר הזה", notes: "הערות",
    supplier: "ספק", status: "סטטוס", loading: "טוען…", noRooms: "לא נמצא חדר", tap: "הקישו על חדר בתוכנית",
    notYet: "עדיין לא פורסמו חדרים בפרויקט הזה", all: "כל הקומה", lighting: "תאורה",
    tagline: "חומרי גמר ואיפיונים לפי חדר", enter: "כניסה", allFloors: "כל הקומות", sqm: 'מ"ר', close: "סגירה",
  },
  en: {
    byRoom: "Search by room", byPlan: "Search by plan", search: "Room number or name", floor: "Floor", room: "Room",
    back: "Back", home: "Home", showPlan: "Show on plan", none: "No finishes defined for this room", notes: "Notes",
    supplier: "Supplier", status: "Status", loading: "Loading…", noRooms: "No room found", tap: "Tap a room on the plan",
    notYet: "No rooms have been published in this project yet", all: "Whole floor", lighting: "Lighting",
    tagline: "Finishes and specifications by room", enter: "Enter", allFloors: "All floors", sqm: "m²", close: "Close",
  },
};
let LANG = "he";
let T = TX.he;
const LANG_KEY = "byroom.lang";
const readLang = () => { try { const v = localStorage.getItem(LANG_KEY); return v === "en" ? "en" : "he"; } catch { return "he"; } };
const saveLang = (v) => { try { localStorage.setItem(LANG_KEY, v); } catch {} };

export const viewCss = `
.brv{--a:#101114;--ai:#103460;--as:#e9eef6;--ink:#17181c;--steel:#5b5e66;--mist:#9a9da5;--ln:#e6e6e9;--bg2:#f6f6f7;
  font-family:'Assistant','Inter',system-ui,sans-serif;color:var(--ink);background:var(--bg2);min-height:100%;height:100%;display:flex;flex-direction:column;position:relative}
.brv *{box-sizing:border-box}
/* 14.11.26 — no scroll bars: the page moves under the finger, as in an app */
.brv,.brv *{scrollbar-width:none;-ms-overflow-style:none}
.brv ::-webkit-scrollbar,.brv::-webkit-scrollbar{display:none;width:0;height:0}
/* 14.11.26 — "By Room" is no longer on the bar: after "כניסה" it heads the screen, under the bar */
.brv-title{position:relative;background:#fff;text-align:center;padding:13px 70px 11px;border-bottom:1px solid var(--ln)}
.brv-title .tt{font-family:'Barlow Condensed','Arial Narrow',sans-serif;font-weight:700;font-size:26px;letter-spacing:.07em;color:#00295c;line-height:1;direction:ltr;display:inline-block}
/* the back button, as in the other apps: "→ חזרה", always to the screen before */
.brv-back{position:absolute;inset-inline-start:8px;top:50%;transform:translateY(-50%);background:none;border:0;font:inherit;font-size:14px;font-weight:600;color:var(--steel);cursor:pointer;padding:6px 6px;display:inline-flex;align-items:center;gap:5px}
.brv-out{display:inline-flex;align-items:flex-end;align-self:center;gap:6px;height:28px;padding:0 4px;background:none;border:none;color:#e3e5ea;font:inherit;font-size:13.5px;font-weight:700;line-height:1;cursor:pointer;flex:none;direction:rtl}
.brv-out svg{display:block;margin-bottom:-1px}
.brv-out span{line-height:1}
.brv button{font-family:inherit}
.brv-bar{display:flex;direction:ltr;align-items:center;gap:6px;padding:calc(env(safe-area-inset-top) + 8px) 12px 8px;background:#101114;color:#fff;min-height:56px;position:sticky;top:0;z-index:4}
.brv-bar .t{position:absolute;left:50%;top:calc(50% + env(safe-area-inset-top) / 2);transform:translate(-50%,-50%);font-weight:800;font-size:17px;letter-spacing:.3px;white-space:nowrap;pointer-events:none;font-family:'Inter','Assistant',system-ui,sans-serif}
.brv-bar .logo{height:28px;width:auto;display:block;flex:none}
.brv-bar .gap{flex:1}
.brv-splash{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:28px 22px 40px;text-align:center;background:#fff;position:relative;overflow:hidden}
/* 14.11.26 — the line drawing of the A. Weiss buildings (as on a-weiss.co.il), light grey, under the content */
.brv-lines{position:absolute;left:0;right:0;bottom:0;width:100%;height:auto;max-height:40%;pointer-events:none;z-index:0;opacity:0;animation:brvLines 1.2s ease .2s forwards}
.brv-lines path{fill:none;stroke:#c3c5ca;stroke-width:2.2;stroke-linejoin:miter;vector-effect:non-scaling-stroke}
@keyframes brvLines{from{opacity:0;transform:translateY(10px)}to{opacity:.7;transform:none}}
.brv-splash > :not(.brv-lines),.brv-home > :not(.brv-lines){position:relative;z-index:1}
.brv-splash .lg{opacity:0;animation:brvIn .7s cubic-bezier(.2,.7,.2,1) forwards}
.brv-splash .lg img{display:block;max-height:64px;max-width:190px;object-fit:contain;margin:0 auto}
.brv-splash .lg.aw img{max-height:78px;max-width:210px}
.brv-splash .lg + .lg{margin-top:6px}
.brv-backrow{background:#fff;border-bottom:1px solid var(--ln);padding:4px 8px}
.brv-backrow button{border:0;background:transparent;font-size:15px;font-weight:700;color:var(--ai);padding:8px 8px;cursor:pointer}
.brv-splash h1{font-size:24px;font-weight:800;margin:6px 0 0;line-height:1.25;opacity:0;animation:brvIn .6s ease forwards}
.brv-splash .sub{color:var(--ai);font-size:15px;font-weight:800;opacity:0;animation:brvIn .6s ease forwards}
.brv-splash .go{margin-top:10px;min-width:210px;padding:15px 28px;border-radius:999px;border:0;background:var(--a);color:#fff;font-size:17px;font-weight:800;cursor:pointer;opacity:0;animation:brvIn .6s ease forwards}
.brv-splash .ln{width:44px;height:2px;background:var(--ln);opacity:0;animation:brvIn .5s ease forwards}
@keyframes brvIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.brv-splash *{animation-duration:.01s!important;animation-delay:0s!important}}
.brv-icon{width:40px;height:40px;border-radius:999px;border:0;background:transparent;font-size:18px;color:#b9bcc4;cursor:pointer;flex:none}
.brv-home{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:28px 18px 40px;text-align:center;position:relative;overflow:hidden;background:#fff}
.brv-logos{display:flex;align-items:center;justify-content:center;gap:26px;flex-wrap:wrap}
.brv-logos img{max-height:56px;max-width:150px;object-fit:contain}
.brv-home h1{font-size:24px;font-weight:800;margin:0;line-height:1.25}
.brv-home .sub{color:var(--ai);font-size:14.5px;font-weight:800;margin-top:-12px}
.brv-big{width:100%;max-width:380px;display:flex;flex-direction:column;gap:12px}
.brv-big button{padding:16px 20px;border-radius:999px;border:1px solid var(--ln);background:#fff;font-size:16px;font-weight:800;color:var(--ai);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px}
.brv-big button.p{background:var(--a);border-color:var(--a);color:#fff}
.brv-big button span.i{font-size:22px;width:28px;text-align:center}
.brv-search{padding:14px;background:#fff;border-bottom:1px solid var(--ln)}
.brv-search input{width:100%;font:inherit;font-size:18px;padding:13px 14px;border:1.5px solid var(--ln);border-radius:14px;outline:none;text-align:center}
.brv-search input::placeholder{text-align:center}
.brv-search input:focus{border-color:var(--a)}
.brv-list{flex:1;overflow:auto;padding:8px 14px 24px}
.brv-res{display:flex;align-items:center;gap:12px;width:100%;text-align:start;padding:14px;margin:8px 0;border-radius:14px;border:1px solid var(--ln);background:#fff;cursor:pointer;color:var(--ink)}
.brv-res b{font-size:19px;min-width:56px;color:var(--ai)}
.brv-res .nm{flex:1;font-size:16px}
.brv-res .fl{font-size:13px;color:var(--steel);white-space:nowrap}
.brv-msg{padding:28px 18px;text-align:center;color:var(--steel)}
.brv-grooms{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin:8px 0 4px}.brv-grooms span{border:1px solid #d9d4f5;background:#f4f2fd;color:#3C3489;border-radius:8px;padding:1px 8px;font-size:12.5px}.brv-grooms span.on{background:#534AB7;color:#fff;border-color:#534AB7}
.brv-note{margin-top:16px;padding:10px 12px;border:1px solid #f1d38c;background:#fffaf0;border-radius:12px;font-size:14px;white-space:pre-wrap;text-align:start}.brv-note b{display:block;margin-bottom:3px}
.brv-chips{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;background:#fff;border-bottom:1px solid var(--ln);justify-content:center}
.brv-search .brv-chips{border-bottom:0;padding:0 0 12px}
.brv-search .brv-chip{padding:7px 14px;font-size:14px}
.brv-chip{flex:none;padding:9px 16px;border-radius:999px;border:1px solid var(--ln);background:#fff;font-size:15px;font-weight:600;cursor:pointer;color:var(--ink)}
.brv-chip.on{background:var(--ai);border-color:var(--ai);color:#fff}
.brv-planwrap{flex:1;display:flex;min-height:0}
.brv-map{flex:1;position:relative;overflow:hidden;touch-action:none;background:#fff;min-height:55vh}
.brv-map svg{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none}
.brv-zoom{position:absolute;bottom:14px;inset-inline-start:14px;display:flex;flex-direction:column;gap:8px}
.brv-zoom button{width:46px;height:46px;border-radius:14px;border:1px solid var(--ln);background:#fff;font-size:22px;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.brv-hint{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(23,24,28,.78);color:#fff;font-size:14px;padding:6px 14px;border-radius:999px;pointer-events:none;white-space:nowrap}
.brv-shade{position:absolute;inset:0;background:rgba(23,24,28,.45);z-index:20;display:flex;align-items:center;justify-content:center;padding:14px}
.brv-modal{background:#fff;border-radius:20px;width:100%;max-width:560px;max-height:88vh;overflow:auto;position:relative;box-shadow:0 20px 50px rgba(0,0,0,.25)}
/* 14.11.26 — on the phone a room (or an item) opens over the whole screen, starting right under "BY ROOM";
   everything behind it, the bar and the "BY ROOM" heading included, is under the dark shade. */
.brv-head{position:sticky;top:0;z-index:30}
.brv-head .brv-bar{position:static}
@media (max-width:899px){
  .brv-shade{z-index:40;align-items:stretch;padding:calc(var(--brv-hdr,0px) + 10px) 10px calc(10px + env(safe-area-inset-bottom))}
  .brv-modal{max-width:none;max-height:none;height:100%}
}
.brv-side{width:min(440px,42%);border-inline-start:1px solid var(--ln);background:#fff;overflow:auto;position:relative}
.brv-x{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;border:0;background:var(--bg2);font-size:18px;cursor:pointer;color:var(--ink);z-index:2}
.brv-card{padding:20px 18px 22px}
.brv-card h2{margin:0;font-size:26px;font-weight:800;color:var(--ink);text-align:center;padding:0 48px}
.brv-card .sub{color:var(--steel);font-size:15px;margin:2px 0 14px;text-align:center}
.brv-cat{margin:16px 0 6px;font-size:14px;font-weight:800;color:var(--ai);letter-spacing:.2px;text-align:center}
.brv-item{display:flex;gap:12px;align-items:center;width:100%;text-align:start;padding:10px;border-radius:14px;border:1px solid var(--ln);background:#fff;margin:6px 0;cursor:pointer;color:var(--ink)}
.brv-item img,.brv-item .ph{width:62px;height:62px;border-radius:10px;object-fit:cover;flex:none;background:var(--as)}
.brv-item .ph{display:flex;align-items:center;justify-content:center;color:var(--ai);font-weight:800;font-size:13px}
.brv-item .c{font-weight:800;font-size:16px}
.brv-item .n{font-size:15px}
.brv-item .d{font-size:13px;color:var(--steel);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.brv-btn{font:inherit;font-size:15px;font-weight:600;padding:11px 16px;border-radius:12px;border:1px solid var(--ln);background:#fff;color:var(--ink);cursor:pointer}
.brv-btn.p{background:var(--a);border-color:var(--a);color:#fff;border-radius:999px;padding:12px 20px}
.brv-full{padding:0 0 20px}
.brv-full img{width:100%;max-height:52vh;object-fit:contain;background:var(--bg2);display:block;border-radius:20px 20px 0 0}
.brv-full .b{padding:16px 18px}
.brv-full h3{margin:0;font-size:24px;font-weight:800;text-align:center}
.brv-full .n{font-size:18px;margin-top:2px;text-align:center}
.brv-full .cat{font-size:13px;color:#103460;font-weight:800;text-align:center}
.brv-full .d{font-size:16px;line-height:1.55;margin-top:12px;white-space:pre-wrap}
.brv-full .kv{display:flex;gap:8px;margin-top:10px;font-size:15px}.brv-full .kv span{color:var(--steel)}
@media (min-width:900px){.brv-home h1,.brv-splash h1{font-size:34px}.brv-list{max-width:760px;width:100%;margin:0 auto}}
`;

// a category typed in By Room travels as "h-" + three base-36 digits per letter (admin.js, build 14)
const kindToName = (k) => { try { return String(k).slice(2).match(/.{3}/g).map((x) => String.fromCodePoint(parseInt(x, 36))).join(""); } catch (e) { return k; } };
const catLabel = (k, cats) => KIND[k]?.[LANG] ?? (k === "lighting" ? T.lighting : (() => { const c = cats?.find((c) => c.key === k); return (LANG === "en" ? c?.en || c?.he : c?.he) ?? (/^h-/.test(k ?? "") ? kindToName(k) : k); })());
const catOrder = (a, b) => { const x = ORDER.indexOf(a), y = ORDER.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b); };
const roomSort = (a, b) => { const x = /^(\d+)(.*)$/.exec(a.n), y = /^(\d+)(.*)$/.exec(b.n); return x && y ? Number(x[1]) - Number(y[1]) || x[2].localeCompare(y[2]) : a.n.localeCompare(b.n); };
// 14.11.26 — the type of the "BY ROOM" heading: a bold condensed sans like the A. Weiss logo, loaded once
if (typeof document !== "undefined" && !document.getElementById("brv-font")) {
  const l = document.createElement("link");
  l.id = "brv-font"; l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&display=swap";
  document.head.appendChild(l);
}
const AW_LOGO = new URL("../sub/logo.png", import.meta.url).href;   // the same logo the subcontractor app shows (white, for the dark bar)
// 14.11.26 — the opening screen: the blue A. Weiss logo the dashboard shows (the same file, sub/brand-logo.svg)
const AW_LOGO_BLUE = new URL("../sub/brand-logo.svg", import.meta.url).href;
// 14.11.26 — the line drawing of the A. Weiss buildings, redrawn as lines (crisp at every size, any colour)
const LINES = html`<svg className="brv-lines" viewBox="0 0 554 398" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
  <path d="M3 281H290M150 281V85L290 3V281M55 281V179L224 97V281M3 281V262L172 180V281" />
  <path d="M264 395H551M264 395V102L404 184V395M330 395V196L499 277V395M382 395V279L551 361V395" />
</svg>`;
const wide = () => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 900px)").matches;

// ----------------------------------------------------------------------------- plan
function useSvgView(map) {
  const full = useMemo(() => (map ? [0, 0, map.w, map.h] : [0, 0, 100, 100]), [map]);
  const [vb, setVb] = useState(full);
  useEffect(() => setVb(full), [full]);
  const zoom = (k, cx, cy) => setVb(([x, y, w, h]) => {
    const nw = Math.min(full[2] * 1.2, Math.max(150, w * k)), nh = nw * (h / w);
    cx = cx ?? x + w / 2; cy = cy ?? y + h / 2;
    return [cx - (cx - x) * (nw / w), cy - (cy - y) * (nh / h), nw, nh];
  });
  const focus = (r, aspect = 1.6) => {
    if (!map || !r) return;
    const nums = (r.d || "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    const bw = xs.length ? Math.max(...xs) - Math.min(...xs) : 300, bh = ys.length ? Math.max(...ys) - Math.min(...ys) : 300;
    const cx = xs.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : r.x, cy = ys.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : r.y;
    const w = Math.max(map.focus ?? 900, bw * 3, (bh * 3) / aspect), h = w * aspect;
    setVb([cx - w / 2, cy - h / 2, w, h]);
  };
  return { vb, setVb, zoom, focus, reset: () => setVb(full) };
}

export function FloorMap({ map, selected, onPick }) {
  const { vb, setVb, zoom, focus, reset } = useSvgView(map);
  const ref = useRef(null);
  const ptrs = useRef(new Map());
  const moved = useRef(false);
  useEffect(() => {
    const b = ref.current?.getBoundingClientRect();
    if (selected) focus(map?.rooms.find((r) => r.n === selected), b && b.width ? b.height / b.width : 1.6);
  }, [selected, map]);
  const toSvg = (dx, dy) => {
    const el = ref.current; if (!el) return [0, 0];
    const b = el.getBoundingClientRect();
    const s = Math.max(vb[2] / b.width, vb[3] / b.height);
    return [dx * s, dy * s];
  };
  // no pointer capture: with capture the browser sends the click to the svg, not to the room that was tapped
  const down = (e) => { ptrs.current.set(e.pointerId, [e.clientX, e.clientY]); moved.current = false; };
  const move = (e) => {
    const p = ptrs.current.get(e.pointerId); if (!p) return;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
      const [c, d] = [...ptrs.current.values()];
      const d1 = Math.hypot(c[0] - d[0], c[1] - d[1]);
      if (d0 > 0 && d1 > 0) zoom(d0 / d1);
      moved.current = true; return;
    }
    const [dx, dy] = toSvg(e.clientX - p[0], e.clientY - p[1]);
    if (Math.abs(e.clientX - p[0]) + Math.abs(e.clientY - p[1]) > 3) moved.current = true;
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    setVb(([x, y, w, h]) => [x - dx, y - dy, w, h]);
  };
  const up = (e) => ptrs.current.delete(e.pointerId);
  const wheel = (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); };
  useEffect(() => { const el = ref.current; el?.addEventListener("wheel", wheel, { passive: false }); return () => el?.removeEventListener("wheel", wheel); });

  if (!map) return html`<div className="brv-msg" style=${{ flex: 1 }}>אין תוכנית לקומה הזו</div>`;
  const fs = Math.max(map.fs ?? 26, vb[2] / 50);   // a plan read from PDF is in points, not centimetres
  return html`<div className="brv-map">
    <svg ref=${ref} viewBox=${vb.join(" ")} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onPointerLeave=${up}>
      ${map.image ? html`<image href=${map.image} x="0" y="0" width=${map.w} height=${map.h} preserveAspectRatio="none" style=${{ opacity: 0.85 }} />` : null}
      ${map.walls ? html`<path d=${map.walls} style=${{ fill: "#c9ccd2" }} fillRule="evenodd" stroke="none" />` : null}
      ${map.rooms.map((r) => {
        const on = r.n === selected;
        const pick = () => { if (!moved.current) onPick(r.n); };
        const rad = fs * (String(r.n).length > 3 ? 1.25 : 1.05);
        return html`<g key=${r.n} onClick=${pick} style=${{ cursor: "pointer" }}>
          ${r.d ? html`<path d=${r.d} style=${{ fill: on ? "#e9eef6" : "rgba(255,255,255,.01)", stroke: on ? "#103460" : "transparent", strokeWidth: on ? 10 : 0 }} />` : null}
          <circle cx=${r.x} cy=${r.y} r=${rad} style=${{ fill: on ? "#103460" : "#fff", stroke: "#103460", strokeWidth: fs / 7 }} />
          <text x=${r.x} y=${r.y + fs / 3} fontSize=${fs * 0.9} textAnchor="middle" fontWeight="800" style=${{ fill: on ? "#fff" : "#103460", fontFamily: "Assistant, Inter, sans-serif" }}>${r.n}</text>
        </g>`;
      })}
    </svg>
    ${!selected && html`<div className="brv-hint">${T.tap}</div>`}
    <div className="brv-zoom">
      <button onClick=${() => zoom(1 / 1.4)} aria-label="zoom in">+</button>
      <button onClick=${() => zoom(1.4)} aria-label="zoom out">−</button>
      <button onClick=${reset} aria-label=${T.all} style=${{ fontSize: "16px" }}>⤢</button>
    </div>
  </div>`;
}

// ----------------------------------------------------------------------------- room card + item
function groupItems(items) {
  const g = new Map();
  for (const it of items || []) { if (!g.has(it.kind)) g.set(it.kind, []); g.get(it.kind).push(it); }
  return [...g.entries()].sort((a, b) => catOrder(a[0], b[0]));
}

function RoomCard({ room, floor, cats, note, group, onItem, onPlan }) {
  if (!room) return html`<div className="brv-card"><div className="brv-msg">${T.loading}</div></div>`;
  const groups = groupItems(room.items);
  return html`<div className="brv-card">
    ${group ? html`<h2>${group.name}</h2>
      <div className="sub">${T.room} ${room.n}${room.name ? ` · ${room.name}` : ""} · ${T.floor} ${floor}</div>
      <div className="brv-grooms">${group.rooms.map((n) => html`<span key=${n} className=${n === room.n ? "on" : ""} dir="ltr">${n}</span>`)}</div>`
    : html`<h2>${T.room} ${room.n}</h2>
    <div className="sub">${room.name || ""}${room.name ? " · " : ""}${T.floor} ${floor}${room.area ? ` · ${Number(room.area)} ${T.sqm}` : ""}</div>`}
    ${!groups.length ? html`<div className="brv-msg">${T.none}</div>` : groups.map(([k, list]) => html`<div key=${k}>
      <div className="brv-cat">${catLabel(k, cats)}</div>
      ${list.map((it) => html`<button className="brv-item" key=${it.code} onClick=${() => onItem(it)}>
        ${it.image ? html`<img src=${it.image} alt="" loading="lazy" />` : html`<div className="ph" dir="ltr">${it.code}</div>`}
        <div style=${{ flex: 1, minWidth: 0 }}>
          <div><span className="c" dir="ltr">${it.code}</span>${it.name && it.name !== it.code ? html`<span className="n"> · ${it.name}</span>` : null}</div>
          ${it.description ? html`<div className="d">${it.description}</div>` : null}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9a9da5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style=${{ flex: "none" }}><path d="M15 6l-6 6 6 6" /></svg>
      </button>`)}
    </div>`)}
    ${note ? html`<div className="brv-note"><b>${T.notes}</b><div>${note}</div></div>` : null}
    ${onPlan ? html`<div style=${{ marginTop: "18px" }}><button className="brv-btn p" onClick=${onPlan}>${T.showPlan}</button></div>` : null}
  </div>`;
}

function ItemCard({ it, cats }) {
  return html`<div className="brv-full">
    ${it.image ? html`<img src=${it.image} alt="" />` : html`<div style=${{ height: "56px" }} />`}
    <div className="b">
      <div className="cat">${catLabel(it.kind, cats)}</div>
      <h3 dir="ltr">${it.code}</h3>
      ${it.name && it.name !== it.code ? html`<div className="n">${it.name}</div>` : null}
      ${it.description ? html`<div className="d">${it.description}</div>` : null}
      ${it.supplier ? html`<div className="kv"><span>${T.supplier}:</span><b>${it.supplier}</b></div>` : null}
      ${it.status ? html`<div className="kv"><span>${T.status}:</span><b>${it.status}</b></div>` : null}
    </div>
  </div>`;
}

function Modal({ onClose, children }) {
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return html`<div className="brv-shade" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div className="brv-modal" role="dialog" aria-modal="true"><button className="brv-x" onClick=${onClose} aria-label=${T.close}>✕</button>${children}</div>
  </div>`;
}

// ----------------------------------------------------------------------------- the app
export function ByRoomViewer({ api, initialFloor, initialRoom, embedded = false, standalone = false }) {
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [screen, setScreen] = useState(initialFloor ? "plan" : "splash");
  // 14.11.26 — no language switch any more (its place on the bar is "יציאה"): Hebrew.
  const lang = "he";
  LANG = lang; T = TX[lang];
  const dir = "rtl";
  const [q, setQ] = useState("");
  const [qFloor, setQFloor] = useState("");   // 14.11.26 — the search by room: one floor, or "" for all
  const [floor, setFloor] = useState(initialFloor ?? null);
  const [floorData, setFloorData] = useState({});
  const [card, setCard] = useState(initialRoom && initialFloor ? { floor: initialFloor, n: initialRoom, from: "plan" } : null);
  const [roomData, setRoomData] = useState(null);
  const [item, setItem] = useState(null);
  const [isWide, setWide] = useState(wide());
  useEffect(() => { const f = () => setWide(wide()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  useEffect(() => { api.home().then((h) => { setHome(h); setFloor((f) => f ?? h.floors[0]?.floor ?? null); }).catch((e) => setErr(String(e.message ?? e))); }, []);
  useEffect(() => { if (screen === "plan" && floor && !floorData[floor]) api.floor(floor).then((d) => setFloorData((x) => ({ ...x, [floor]: d }))).catch((e) => setErr(String(e.message ?? e))); }, [screen, floor]);
  useEffect(() => {
    if (!card) { setRoomData(null); return; }
    let off = false; setRoomData(null);
    api.room(card.floor, card.n).then((d) => !off && setRoomData(d.room ?? { n: card.n, items: [] })).catch((e) => !off && setErr(String(e.message ?? e)));
    return () => { off = true; };
  }, [card?.floor, card?.n]);

  const p = home?.project ?? {};
  const cats = p.categories;
  const style = undefined;
  const all = useMemo(() => (home?.floors ?? []).flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.floor }))), [home]);
  const qq = q.trim().toLowerCase();
  const inFloor = all.filter((r) => !qFloor || r.floor === qFloor);
  const results = qq ? inFloor.filter((r) => r.n.toLowerCase().includes(qq) || (r.name ?? "").toLowerCase().includes(qq)).sort(roomSort) : inFloor.slice().sort((a, b) => Number(a.floor) - Number(b.floor) || roomSort(a, b));
  // 14.11.26 — every step is kept, so "→ חזרה" (and, on the phone page, the phone's own back) always returns
  // to the screen before: a card closes back to its list or plan, a list back to the main screen, the main
  // screen back to the opening. Inside the dashboard the steps are kept here only, so the dashboard's own
  // history is not touched.
  const stack = useRef([]);
  // the height of the bar + "BY ROOM", so a room card opens right under them (14.11.26)
  const headRef = useRef(null);
  const rootRef = useRef(null);
  useEffect(() => {
    const set = () => { const h = headRef.current?.offsetHeight; if (h && rootRef.current) rootRef.current.style.setProperty("--brv-hdr", h + "px"); };
    set();
    const ro = typeof ResizeObserver !== "undefined" && headRef.current ? new ResizeObserver(set) : null;
    if (ro) ro.observe(headRef.current);
    return () => ro?.disconnect();
  });
  const now = useRef({});
  now.current = { screen, card, item };
  const apply = (s) => {
    if ("screen" in s) setScreen(s.screen);
    if ("card" in s) setCard(s.card);
    if ("item" in s) setItem(s.item);
    if (s.floor) setFloor(s.floor);
  };
  const popOne = () => {
    const prev = stack.current.pop();
    if (prev) apply(prev);
    else apply({ screen: now.current.screen === "home" ? "splash" : "home", card: null, item: null });
  };
  const exiting = useRef(false);
  useEffect(() => {
    if (!standalone) return;
    const onPop = () => {
      if (exiting.current) { exiting.current = false; stack.current = []; apply({ screen: "splash", card: null, item: null }); return; }
      popOne();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [standalone]);
  const go = (patch) => {
    stack.current.push({ ...now.current });
    apply(patch);
    if (standalone) try { history.pushState({ brv: stack.current.length }, ""); } catch (e) {}
  };
  const back = () => {
    if (standalone && stack.current.length) { history.back(); return; }
    popOne();
  };
  // יציאה: back to the opening screen, every step dropped
  const exit = () => {
    const n = stack.current.length;
    if (standalone && n) { exiting.current = true; history.go(-n); return; }
    stack.current = []; apply({ screen: "splash", card: null, item: null });
  };
  const closeCard = back;
  const openCard = (c) => (now.current.card && !now.current.item ? apply({ card: c }) : go({ card: c, item: null }));
  const toPlan = () => { const c = card; go({ screen: "plan", floor: c.floor, card: { ...c, from: "plan" }, item: null }); };

  // the black bar: A. Weiss logo on the left, "יציאה" with the door on the right (as in the other apps).
  // 14.11.26 — after "כניסה", under the bar: "→ חזרה" and the "BY ROOM" heading in the logo's type.
  const bar = () => html`<div className="brv-head" ref=${headRef}><div className="brv-bar">
    <img className="logo" src=${AW_LOGO} alt="A. Weiss" />
    <span className="gap" />
    ${screen !== "splash" ? html`<button className="brv-out" onClick=${exit}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/></svg><span>יציאה</span></button>` : null}
  </div>${screen !== "splash" ? html`<div className="brv-title"><button className="brv-back" onClick=${back}>→ ${T.back}</button><span className="tt">BY ROOM</span></div>` : null}</div>`;

  if (err) return html`<div className="brv" dir=${dir} style=${style}><style>${viewCss}</style><div className="brv-msg">${err}</div></div>`;
  if (!home) return html`<div className="brv" dir=${dir}><style>${viewCss}</style><div className="brv-msg">${T.loading}</div></div>`;

  const cardBody = card && html`<${RoomCard} room=${roomData} floor=${card.floor} cats=${cats} note=${roomData ? p.roomNotes?.[card.floor + "|" + roomData.n] : null} group=${roomData ? (p.roomGroups ?? []).find((g) => g.floor === card.floor && g.rooms.includes(roomData.n)) : null} onItem=${(it) => go({ item: it })} onPlan=${card.from === "search" ? toPlan : null} />`;
  const fd = floorData[floor];
  // opening (14.11.26): A. Weiss (the blue logo), then the client, then the supervision, and "Enter" — logos only
  const seq = ["aw", p.clientLogo && "c", p.supervisionLogo && "s"].filter(Boolean);
  const d = (i) => ({ animationDelay: `${0.15 + i * 0.55}s` });
  const n = seq.length;
  return html`<div className="brv" ref=${rootRef} dir=${dir} style=${style}>
    <style>${viewCss}</style>
    ${screen === "splash" ? html`${bar()}<div className="brv-splash">
        ${seq.map((k, i) => html`<div key=${k} className=${`lg ${k}`} style=${d(i)}><img src=${k === "c" ? p.clientLogo : k === "s" ? p.supervisionLogo : AW_LOGO_BLUE} alt=${k === "aw" ? "A. Weiss" : ""} /></div>`)}
        <button className="go" style=${d(n + 0.2)} onClick=${() => go({ screen: "home" })}>${T.enter}</button>
        ${LINES}
      </div>`
    : screen === "home" ? html`${bar()}<div className="brv-home">
        <h1 dir="auto">${p.name ?? ""}</h1>
        <div className="sub">${T.tagline}</div>
        ${!home.floors.length ? html`<div className="brv-msg">${T.notYet}</div>` : html`<div className="brv-big">
          <button className="p" onClick=${() => go({ screen: "search" })}><span className="i">⌕</span>${T.byRoom}</button>
          <button onClick=${() => go({ screen: "plan" })}><span className="i">▦</span>${T.byPlan}</button>
        </div>`}
        ${LINES}
      </div>`
    : screen === "search" ? html`
      ${bar()}
      <div className="brv-search">
        ${home.floors.length > 1 ? html`<div className="brv-chips">
          <button className=${`brv-chip ${!qFloor ? "on" : ""}`} onClick=${() => setQFloor("")}>${T.allFloors}</button>
          ${home.floors.map((f) => html`<button key=${f.floor} className=${`brv-chip ${f.floor === qFloor ? "on" : ""}`} onClick=${() => setQFloor(f.floor)}>${T.floor} ${f.floor}</button>`)}
        </div>` : null}
        <input autoFocus inputMode="search" placeholder=${T.search} value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div className="brv-list">
        ${!results.length ? html`<div className="brv-msg">${T.noRooms}</div>` : results.slice(0, 200).map((r) => html`<button className="brv-res" key=${r.floor + "|" + r.n} onClick=${() => openCard({ floor: r.floor, n: r.n, from: "search" })}>
          <b dir="ltr">${r.n}</b><span className="nm">${r.name ?? ""}</span><span className="fl">${T.floor} ${r.floor}</span></button>`)}
      </div>`
    : html`
      ${bar()}
      ${home.floors.length > 1 ? html`<div className="brv-chips">${home.floors.map((f) => html`<button key=${f.floor} className=${`brv-chip ${f.floor === floor ? "on" : ""}`} onClick=${() => { setFloor(f.floor); if (card) apply({ card: null, item: null }); }}>${T.floor} ${f.floor}</button>`)}</div>` : null}
      <div className="brv-planwrap">
        ${!fd ? html`<div className="brv-msg" style=${{ flex: 1 }}>${T.loading}</div>` : html`<${FloorMap} map=${fd.map} selected=${card?.floor === floor ? card.n : null} onPick=${(n) => openCard({ floor, n, from: "plan" })} />`}
        ${isWide && card ? html`<div className="brv-side"><button className="brv-x" onClick=${closeCard} aria-label=${T.close}>✕</button>${cardBody}</div>` : null}
      </div>`}
    ${card && !(isWide && screen === "plan") && !item ? html`<${Modal} onClose=${closeCard}>${cardBody}</${Modal}>` : null}
    ${item ? html`<${Modal} onClose=${back}><${ItemCard} it=${item} cats=${cats} /></${Modal}>` : null}
  </div>`;
}

/** The QR page's data: the byroom-public function, with the project key from the link. */
export function publicApi(base, key) {
  const get = async (q) => {
    const r = await fetch(`${base}/byroom-public?${new URLSearchParams({ k: key, ...q })}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error === "this link is no longer valid" ? "הקישור הזה כבר לא פעיל. בקשו קישור חדש ממנהלת הפרויקט." : j.error || `שגיאה ${r.status}`);
    return j;
  };
  return { home: () => get({}), floor: (f) => get({ f }), room: (f, r) => get({ f, r }) };
}
