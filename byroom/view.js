// =============================================================================
//  byroom/view.js — the client's By Room: view only, mobile first. A. Weiss · By Room
//  byroom build 7 · 25.10.2026
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
    back: "חזרה", home: "מסך ראשי", showPlan: "הצגה על התוכנית", none: "לא הוגדרו איפיונים לחדר הזה",
    supplier: "ספק", status: "סטטוס", loading: "טוען…", noRooms: "לא נמצא חדר", tap: "הקישו על חדר בתוכנית",
    notYet: "עדיין לא פורסמו חדרים בפרויקט הזה", all: "כל הקומה", lighting: "תאורה",
    tagline: "חומרי גמר ואיפיונים לפי חדר", enter: "כניסה", sqm: 'מ"ר', close: "סגירה",
  },
  en: {
    byRoom: "Search by room", byPlan: "Search by plan", search: "Room number or name", floor: "Floor", room: "Room",
    back: "Back", home: "Home", showPlan: "Show on plan", none: "No finishes defined for this room",
    supplier: "Supplier", status: "Status", loading: "Loading…", noRooms: "No room found", tap: "Tap a room on the plan",
    notYet: "No rooms have been published in this project yet", all: "Whole floor", lighting: "Lighting",
    tagline: "Finishes and specifications by room", enter: "Enter", sqm: "m²", close: "Close",
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
.brv button{font-family:inherit}
.brv-bar{display:flex;direction:ltr;align-items:center;gap:6px;padding:calc(env(safe-area-inset-top) + 8px) 12px 8px;background:#101114;color:#fff;min-height:56px;position:sticky;top:0;z-index:4}
.brv-bar .t{position:absolute;left:50%;top:calc(50% + env(safe-area-inset-top) / 2);transform:translate(-50%,-50%);font-weight:800;font-size:17px;letter-spacing:.3px;white-space:nowrap;pointer-events:none;font-family:'Inter','Assistant',system-ui,sans-serif}
.brv-bar .logo{height:28px;width:auto;display:block;flex:none}
.brv-bar .gap{flex:1}
.brv-lang{display:flex;align-items:center;border:1px solid #3a3d45;border-radius:999px;overflow:hidden;flex:none;font-family:'Inter',system-ui,sans-serif}
.brv-lang button{border:0;background:transparent;color:#b9bcc4;font-size:12px;font-weight:800;padding:6px 10px;cursor:pointer;letter-spacing:.4px}
.brv-lang button.on{background:#fff;color:#101114}
.brv-splash{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:28px 22px 40px;text-align:center;background:#fff}
.brv-splash .lg{opacity:0;animation:brvIn .7s cubic-bezier(.2,.7,.2,1) forwards}
.brv-splash .lg img{display:block;max-height:64px;max-width:190px;object-fit:contain;margin:0 auto}
.brv-splash .lg.aw{background:#101114;border-radius:14px;padding:10px 18px}
.brv-splash .lg.aw img{max-height:34px}
.brv-backrow{background:#fff;border-bottom:1px solid var(--ln);padding:4px 8px}
.brv-backrow button{border:0;background:transparent;font-size:15px;font-weight:700;color:var(--ai);padding:8px 8px;cursor:pointer}
.brv-splash h1{font-size:24px;font-weight:800;margin:6px 0 0;line-height:1.25;opacity:0;animation:brvIn .6s ease forwards}
.brv-splash .sub{color:var(--ai);font-size:15px;font-weight:800;opacity:0;animation:brvIn .6s ease forwards}
.brv-splash .go{margin-top:10px;min-width:210px;padding:15px 28px;border-radius:999px;border:0;background:var(--a);color:#fff;font-size:17px;font-weight:800;cursor:pointer;opacity:0;animation:brvIn .6s ease forwards}
.brv-splash .ln{width:44px;height:2px;background:var(--ln);opacity:0;animation:brvIn .5s ease forwards}
@keyframes brvIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.brv-splash *{animation-duration:.01s!important;animation-delay:0s!important}}
.brv-icon{width:40px;height:40px;border-radius:999px;border:0;background:transparent;font-size:18px;color:#b9bcc4;cursor:pointer;flex:none}
.brv-home{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:28px 18px 40px;text-align:center}
.brv-logos{display:flex;align-items:center;justify-content:center;gap:26px;flex-wrap:wrap}
.brv-logos img{max-height:56px;max-width:150px;object-fit:contain}
.brv-home h1{font-size:24px;font-weight:800;margin:0;line-height:1.25}
.brv-home .sub{color:var(--ai);font-size:14.5px;font-weight:800;margin-top:-12px}
.brv-big{width:100%;max-width:380px;display:flex;flex-direction:column;gap:12px}
.brv-big button{padding:16px 20px;border-radius:999px;border:1px solid var(--ln);background:#fff;font-size:16px;font-weight:800;color:var(--ai);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px}
.brv-big button.p{background:var(--a);border-color:var(--a);color:#fff}
.brv-big button span.i{font-size:22px;width:28px;text-align:center}
.brv-search{padding:14px;background:#fff;border-bottom:1px solid var(--ln)}
.brv-search input{width:100%;font:inherit;font-size:18px;padding:13px 14px;border:1.5px solid var(--ln);border-radius:14px;outline:none}
.brv-search input:focus{border-color:var(--a)}
.brv-list{flex:1;overflow:auto;padding:8px 14px 24px}
.brv-res{display:flex;align-items:center;gap:12px;width:100%;text-align:start;padding:14px;margin:8px 0;border-radius:14px;border:1px solid var(--ln);background:#fff;cursor:pointer;color:var(--ink)}
.brv-res b{font-size:19px;min-width:56px;color:var(--ai)}
.brv-res .nm{flex:1;font-size:16px}
.brv-res .fl{font-size:13px;color:var(--steel);white-space:nowrap}
.brv-msg{padding:28px 18px;text-align:center;color:var(--steel)}
.brv-chips{display:flex;gap:8px;overflow:auto;padding:10px 14px;background:#fff;border-bottom:1px solid var(--ln)}
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
.brv-side{width:min(440px,42%);border-inline-start:1px solid var(--ln);background:#fff;overflow:auto;position:relative}
.brv-x{position:absolute;top:12px;inset-inline-end:12px;width:40px;height:40px;border-radius:50%;border:0;background:var(--bg2);font-size:18px;cursor:pointer;color:var(--ink);z-index:2}
.brv-card{padding:20px 18px 22px}
.brv-card h2{margin:0;font-size:26px;font-weight:800;color:var(--ink)}
.brv-card .sub{color:var(--steel);font-size:15px;margin:2px 0 14px}
.brv-cat{margin:16px 0 6px;font-size:14px;font-weight:800;color:var(--ai);letter-spacing:.2px}
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
.brv-full h3{margin:0;font-size:24px;font-weight:800}
.brv-full .n{font-size:18px;margin-top:2px}
.brv-full .d{font-size:16px;line-height:1.55;margin-top:12px;white-space:pre-wrap}
.brv-full .kv{display:flex;gap:8px;margin-top:10px;font-size:15px}.brv-full .kv span{color:var(--steel)}
@media (min-width:900px){.brv-home h1,.brv-splash h1{font-size:34px}.brv-list{max-width:760px;width:100%;margin:0 auto}}
`;

const catLabel = (k, cats) => KIND[k]?.[LANG] ?? (k === "lighting" ? T.lighting : (() => { const c = cats?.find((c) => c.key === k); return (LANG === "en" ? c?.en || c?.he : c?.he) ?? k; })());
const catOrder = (a, b) => { const x = ORDER.indexOf(a), y = ORDER.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b); };
const roomSort = (a, b) => { const x = /^(\d+)(.*)$/.exec(a.n), y = /^(\d+)(.*)$/.exec(b.n); return x && y ? Number(x[1]) - Number(y[1]) || x[2].localeCompare(y[2]) : a.n.localeCompare(b.n); };
const AW_LOGO = new URL("../sub/logo.png", import.meta.url).href;   // the same logo the subcontractor app shows
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

function RoomCard({ room, floor, cats, onItem, onPlan }) {
  if (!room) return html`<div className="brv-card"><div className="brv-msg">${T.loading}</div></div>`;
  const groups = groupItems(room.items);
  return html`<div className="brv-card">
    <h2>${T.room} ${room.n}</h2>
    <div className="sub">${room.name || ""}${room.name ? " · " : ""}${T.floor} ${floor}${room.area ? ` · ${Number(room.area)} ${T.sqm}` : ""}</div>
    ${!groups.length ? html`<div className="brv-msg">${T.none}</div>` : groups.map(([k, list]) => html`<div key=${k}>
      <div className="brv-cat">${catLabel(k, cats)}</div>
      ${list.map((it) => html`<button className="brv-item" key=${it.code} onClick=${() => onItem(it)}>
        ${it.image ? html`<img src=${it.image} alt="" loading="lazy" />` : html`<div className="ph" dir="ltr">${it.code}</div>`}
        <div style=${{ flex: 1, minWidth: 0 }}>
          <div><span className="c" dir="ltr">${it.code}</span>${it.name && it.name !== it.code ? html`<span className="n"> · ${it.name}</span>` : null}</div>
          ${it.description ? html`<div className="d">${it.description}</div>` : null}
        </div>
        <span style=${{ color: "var(--mist,#9a9da5)", fontSize: "18px" }}>‹</span>
      </button>`)}
    </div>`)}
    ${onPlan ? html`<div style=${{ marginTop: "18px" }}><button className="brv-btn p" onClick=${onPlan}>${T.showPlan}</button></div>` : null}
  </div>`;
}

function ItemCard({ it, cats }) {
  return html`<div className="brv-full">
    ${it.image ? html`<img src=${it.image} alt="" />` : html`<div style=${{ height: "56px" }} />`}
    <div className="b">
      <div style=${{ fontSize: "13px", color: "#103460", fontWeight: 800 }}>${catLabel(it.kind, cats)}</div>
      <h3 dir="ltr" style=${{ textAlign: "start" }}>${it.code}</h3>
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
export function ByRoomViewer({ api, initialFloor, initialRoom, embedded = false }) {
  const [home, setHome] = useState(null);
  const [err, setErr] = useState(null);
  const [screen, setScreen] = useState(initialFloor ? "plan" : "splash");
  const [lang, setLangState] = useState(readLang);
  const setLang = (v) => { setLangState(v); saveLang(v); };
  LANG = lang; T = TX[lang];
  const dir = lang === "en" ? "ltr" : "rtl";
  const [q, setQ] = useState("");
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
  const results = qq ? all.filter((r) => r.n.toLowerCase().includes(qq) || (r.name ?? "").toLowerCase().includes(qq)).sort(roomSort) : all.slice().sort((a, b) => Number(a.floor) - Number(b.floor) || roomSort(a, b));
  const closeCard = () => { setCard(null); setItem(null); };
  const toPlan = () => { const c = card; setScreen("plan"); setFloor(c.floor); setCard({ ...c, from: "plan" }); };

  // the black bar: A. Weiss logo on the left, "By Room" (always in English) in the exact middle, HE | EN on the right
  const bar = (onBack) => html`<div className="brv-bar">
    <img className="logo" src=${AW_LOGO} alt="A. Weiss" />
    <div className="t">By Room</div>
    <span className="gap" />
    <div className="brv-lang" role="group" aria-label="language">
      <button className=${lang === "he" ? "on" : ""} onClick=${() => setLang("he")}>HE</button>
      <button className=${lang === "en" ? "on" : ""} onClick=${() => setLang("en")}>EN</button>
    </div>
  </div>${onBack ? html`<div className="brv-backrow"><button onClick=${onBack}>${lang === "en" ? "‹" : "›"} ${T.back}</button></div>` : null}`;

  if (err) return html`<div className="brv" dir=${dir} style=${style}><style>${viewCss}</style><div className="brv-msg">${err}</div></div>`;
  if (!home) return html`<div className="brv" dir=${dir}><style>${viewCss}</style><div className="brv-msg">${T.loading}</div></div>`;

  const cardBody = card && html`<${RoomCard} room=${roomData} floor=${card.floor} cats=${cats} onItem=${setItem} onPlan=${card.from === "search" ? toPlan : null} />`;
  const fd = floorData[floor];
  // opening: client logo, then supervision, then A. Weiss, then the project name (as it was set up), the line, and "Enter"
  const seq = [p.clientLogo && "c", p.supervisionLogo && "s", "aw"].filter(Boolean);
  const d = (i) => ({ animationDelay: `${0.15 + i * 0.55}s` });
  const n = seq.length;
  return html`<div className="brv" dir=${dir} style=${style}>
    <style>${viewCss}</style>
    ${screen === "splash" ? html`${bar(null)}<div className="brv-splash">
        ${seq.map((k, i) => html`<div key=${k} className=${`lg ${k}`} style=${d(i)}><img src=${k === "c" ? p.clientLogo : k === "s" ? p.supervisionLogo : AW_LOGO} alt=${k === "aw" ? "A. Weiss" : ""} /></div>`)}
        <div className="ln" style=${d(n)} />
        <h1 dir="auto" style=${d(n)}>${p.name ?? ""}</h1>
        <div className="sub" style=${d(n + 0.6)}>${T.tagline}</div>
        <button className="go" style=${d(n + 1.2)} onClick=${() => setScreen("home")}>${T.enter}</button>
      </div>`
    : screen === "home" ? html`${bar(null)}<div className="brv-home">
        <h1 dir="auto">${p.name ?? ""}</h1>
        <div className="sub">${T.tagline}</div>
        ${!home.floors.length ? html`<div className="brv-msg">${T.notYet}</div>` : html`<div className="brv-big">
          <button className="p" onClick=${() => setScreen("search")}><span className="i">⌕</span>${T.byRoom}</button>
          <button onClick=${() => setScreen("plan")}><span className="i">▦</span>${T.byPlan}</button>
        </div>`}
      </div>`
    : screen === "search" ? html`
      ${bar(() => setScreen("home"))}
      <div className="brv-search"><input autoFocus inputMode="search" placeholder=${T.search} value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div className="brv-list">
        ${!results.length ? html`<div className="brv-msg">${T.noRooms}</div>` : results.slice(0, 200).map((r) => html`<button className="brv-res" key=${r.floor + "|" + r.n} onClick=${() => setCard({ floor: r.floor, n: r.n, from: "search" })}>
          <b dir="ltr">${r.n}</b><span className="nm">${r.name ?? ""}</span><span className="fl">${T.floor} ${r.floor}</span></button>`)}
      </div>`
    : html`
      ${bar(() => { setScreen("home"); closeCard(); })}
      ${home.floors.length > 1 ? html`<div className="brv-chips">${home.floors.map((f) => html`<button key=${f.floor} className=${`brv-chip ${f.floor === floor ? "on" : ""}`} onClick=${() => { setFloor(f.floor); closeCard(); }}>${T.floor} ${f.floor}</button>`)}</div>` : null}
      <div className="brv-planwrap">
        ${!fd ? html`<div className="brv-msg" style=${{ flex: 1 }}>${T.loading}</div>` : html`<${FloorMap} map=${fd.map} selected=${card?.floor === floor ? card.n : null} onPick=${(n) => setCard({ floor, n, from: "plan" })} />`}
        ${isWide && card ? html`<div className="brv-side"><button className="brv-x" onClick=${closeCard} aria-label=${T.close}>✕</button>${cardBody}</div>` : null}
      </div>`}
    ${card && !(isWide && screen === "plan") && !item ? html`<${Modal} onClose=${closeCard}>${cardBody}</${Modal}>` : null}
    ${item ? html`<${Modal} onClose=${() => setItem(null)}><${ItemCard} it=${item} cats=${cats} /></${Modal}>` : null}
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
