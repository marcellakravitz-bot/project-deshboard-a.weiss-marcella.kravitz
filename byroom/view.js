// =============================================================================
//  byroom/view.js — the room viewer, and nothing else. A. Weiss · By Room
//  One copy, used by the phone page opened from a QR code (byroom/index.html)
//  and by the By Room cube inside the dashboard for a signed-in viewer.
//  View only: there is no button here that changes anything.
//
//  It is given a loader, so it does not care where the data comes from:
//    load(floor, room) -> { project, floor, map, rooms: [{n,name}], room: {n,name,area,finishes:[{kind,code}]}, sheets }
//    openSheet(floor, kind) -> url of the approved PDF sheet (optional)
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);

export const KIND = {
  FL: { he: "ריצוף", en: "Flooring" },
  FN: { he: "חיפוי קירות", en: "Wall finishes" },
  CL: { he: "תקרה", en: "Ceiling" },
};
const T = {
  floor: { he: "קומה", en: "Floor" }, room: { he: "חדר", en: "Room" }, search: { he: "מספר חדר", en: "Room no." },
  go: { he: "הצג", en: "Show" }, area: { he: "שטח", en: "Area" }, none: { he: "לא צוין", en: "Not specified" },
  sheet: { he: "פתיחת התוכנית", en: "Open the sheet" }, notFound: { he: "החדר לא נמצא בקומה הזו", en: "Room not found on this floor" },
  loading: { he: "טוען…", en: "Loading…" }, tap: { he: "הקישו על חדר במפה", en: "Tap a room on the map" },
  all: { he: "כל הקומה", en: "Whole floor" }, noMap: { he: "אין עדיין תוכנית מאושרת לקומה הזו", en: "No approved plan for this floor yet" },
};

export const viewCss = `
.brv{font-family:system-ui,"Segoe UI",Arial,sans-serif;color:#1f2430;background:#f4f5f7;min-height:100%;display:flex;flex-direction:column}
.brv-top{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#fff;border-bottom:1px solid #e3e5ea;position:sticky;top:0;z-index:3}
.brv-title{font-weight:700;font-size:16px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brv-top select,.brv-top input{font:inherit;font-size:16px;padding:8px 10px;border:1px solid #cfd3db;border-radius:10px;background:#fff}
.brv-top input{width:96px}
.brv-btn{font:inherit;font-size:15px;padding:9px 14px;border-radius:10px;border:1px solid #cfd3db;background:#fff;color:#1f2430;cursor:pointer}
.brv-btn.primary{background:#9F1239;border-color:#9F1239;color:#fff}
.brv-map{flex:1;position:relative;overflow:hidden;touch-action:none;background:#fff;min-height:55vh}
.brv-map svg{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none}
.brv-zoom{position:absolute;bottom:12px;inset-inline-start:12px;display:flex;flex-direction:column;gap:6px}
.brv-zoom button{width:44px;height:44px;border-radius:12px;border:1px solid #cfd3db;background:#fff;font-size:22px}
.brv-hint{position:absolute;top:10px;left:50%;transform:translateX(-50%);background:rgba(31,36,48,.75);color:#fff;font-size:13px;padding:5px 12px;border-radius:999px;pointer-events:none}
.brv-sheet{position:fixed;left:0;right:0;bottom:0;background:#fff;border-radius:18px 18px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.18);padding:14px 16px 22px;max-height:72vh;overflow:auto;z-index:5}
.brv-sheet h2{margin:0;font-size:22px}
.brv-sheet .sub{color:#5b6170;margin:2px 0 12px;font-size:15px}
.brv-x{position:absolute;top:10px;inset-inline-end:12px;width:40px;height:40px;border-radius:50%;border:0;background:#eef0f3;font-size:20px}
.brv-k{margin:12px 0 4px;font-size:13px;color:#5b6170;font-weight:600}
.brv-codes{display:flex;flex-wrap:wrap;gap:8px}
.brv-code{font-size:17px;font-weight:700;padding:8px 12px;border-radius:10px;background:#f6e8ec;color:#7A0E2C}
.brv-code.none{background:#eef0f3;color:#8a8f9c;font-weight:500}
.brv-sheets{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.brv-msg{padding:24px;text-align:center;color:#5b6170}
`;

function useSvgView(map) {
  const full = useMemo(() => (map ? [0, 0, map.w, map.h] : [0, 0, 100, 100]), [map]);
  const [vb, setVb] = useState(full);
  useEffect(() => setVb(full), [full]);
  const zoom = (k, cx, cy) => setVb(([x, y, w, h]) => {
    const nw = Math.min(full[2] * 1.2, Math.max(150, w * k)), nh = nw * (h / w);
    cx = cx ?? x + w / 2; cy = cy ?? y + h / 2;
    return [cx - (cx - x) * (nw / w), cy - (cy - y) * (nh / h), nw, nh];
  });
  // zoom to a room and keep it in the upper part of the screen, above the room sheet
  const focus = (r, aspect = 1.6) => {
    if (!map || !r) return;
    const nums = (r.d || "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    const bw = xs.length ? Math.max(...xs) - Math.min(...xs) : 300, bh = ys.length ? Math.max(...ys) - Math.min(...ys) : 300;
    const cx = xs.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : r.x, cy = ys.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : r.y;
    const w = Math.max(700, bw * 2.4, (bh * 2.6) / aspect), h = w * aspect;
    setVb([cx - w / 2, cy - h * 0.27, w, h]);
  };
  return { vb, setVb, zoom, focus, reset: () => setVb(full) };
}

function FloorMap({ map, selected, onPick, lang }) {
  const { vb, setVb, zoom, focus, reset } = useSvgView(map);
  const ref = useRef(null);
  const ptrs = useRef(new Map());
  const moved = useRef(false);
  useEffect(() => {
    const b = ref.current?.getBoundingClientRect();
    focus(map?.rooms.find((r) => r.n === selected), b && b.width ? b.height / b.width : 1.6);
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

  if (!map) return html`<div className="brv-msg">${T.noMap[lang]}</div>`;
  const fs = Math.max(28, vb[2] / 45);
  return html`<div className="brv-map">
    <svg ref=${ref} viewBox=${vb.join(" ")} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onPointerLeave=${up}>
      <path d=${map.walls} fill="#9aa1ad" fillRule="evenodd" stroke="none" />
      ${map.rooms.map((r) => {
        const on = r.n === selected;
        const pick = () => { if (!moved.current) onPick(r.n); };
        return html`<g key=${r.n} onClick=${pick} style=${{ cursor: "pointer" }}>
          ${r.d ? html`<path d=${r.d} fill=${on ? "#9F1239" : "#e7eef8"} fillOpacity=${on ? 0.35 : 0.9} stroke=${on ? "#9F1239" : "#b9c7da"} strokeWidth=${on ? 10 : 4} />`
                : html`<circle cx=${r.x} cy=${r.y} r=${on ? 70 : 55} fill=${on ? "#9F1239" : "#fde8c8"} fillOpacity=${on ? 0.45 : 0.95} stroke=${on ? "#9F1239" : "#e0a64a"} strokeWidth="6" />`}
          <text x=${r.x} y=${r.y + fs / 3} fontSize=${fs} textAnchor="middle" fontWeight="700" fill=${on ? "#7A0E2C" : "#2b3140"}>${r.n}</text>
        </g>`;
      })}
    </svg>
    ${!selected && html`<div className="brv-hint">${T.tap[lang]}</div>`}
    <div className="brv-zoom">
      <button onClick=${() => zoom(1 / 1.4)} aria-label="zoom in">+</button>
      <button onClick=${() => zoom(1.4)} aria-label="zoom out">−</button>
      <button onClick=${reset} aria-label=${T.all[lang]} style=${{ fontSize: "14px" }}>⤢</button>
    </div>
  </div>`;
}

function RoomSheet({ room, floor, sheets, onClose, openSheet, lang }) {
  const by = (k) => (room.finishes || []).filter((f) => f.kind === k).map((f) => f.code);
  return html`<div className="brv-sheet" role="dialog" aria-modal="true">
    <button className="brv-x" onClick=${onClose} aria-label="close">✕</button>
    <h2>${T.room[lang]} ${room.n}</h2>
    <div className="sub">${room.name || ""}${room.name ? " · " : ""}${T.floor[lang]} ${floor}${room.area ? ` · ${T.area[lang]} ${Number(room.area)} ${lang === "he" ? "מ\"ר" : "m²"}` : ""}</div>
    ${["FL", "FN", "CL"].map((k) => {
      const c = by(k);
      return html`<div key=${k}>
        <div className="brv-k">${KIND[k][lang]}</div>
        <div className="brv-codes">${c.length ? c.map((x) => html`<span className="brv-code" key=${x}>${x}</span>`) : html`<span className="brv-code none">${T.none[lang]}</span>`}</div>
      </div>`;
    })}
    ${openSheet && sheets?.length ? html`<div className="brv-sheets">
      ${sheets.map((k) => html`<button className="brv-btn" key=${k} onClick=${() => openSheet(floor, k)}>${T.sheet[lang]} · ${KIND[k]?.[lang] ?? k}</button>`)}
    </div>` : null}
  </div>`;
}

export function RoomViewer({ load, openSheet, floors = [], initialFloor, initialRoom, lang = "he", title }) {
  const [floor, setFloor] = useState(initialFloor ?? floors[0] ?? null);
  const [room, setRoom] = useState(initialRoom ?? null);
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);
  useEffect(() => { if (!floor && floors.length) setFloor(floors[0]); }, [floors]);
  useEffect(() => {
    if (!floor) return;
    let off = false;
    setErr(null);
    load(floor, room).then((d) => { if (!off) { setData(d); if (room && !d.room) setErr(T.notFound[lang]); } })
      .catch((e) => !off && setErr(String(e.message ?? e)));
    return () => { off = true; };
  }, [floor, room]);
  const go = () => { const v = q.trim(); if (v) setRoom(v); };
  return html`<div className="brv" dir=${lang === "he" ? "rtl" : "ltr"}>
    <style>${viewCss}</style>
    <div className="brv-top">
      <div className="brv-title">${title ?? data?.project ?? ""}</div>
      ${floors.length > 1 ? html`<select value=${floor ?? ""} onChange=${(e) => { setRoom(null); setFloor(e.target.value); }}>
        ${floors.map((f) => html`<option key=${f} value=${f}>${T.floor[lang]} ${f}</option>`)}</select>` : floor ? html`<span>${T.floor[lang]} ${floor}</span>` : null}
      <input inputMode="text" placeholder=${T.search[lang]} value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && go()} />
      <button className="brv-btn primary" onClick=${go}>${T.go[lang]}</button>
    </div>
    ${err && html`<div className="brv-msg">${err}</div>`}
    ${!data ? html`<div className="brv-msg">${T.loading[lang]}</div>` : html`<${FloorMap} map=${data.map} selected=${room} onPick=${setRoom} lang=${lang} />`}
    ${data?.room && room && html`<${RoomSheet} room=${data.room} floor=${floor} sheets=${data.sheets} openSheet=${openSheet} lang=${lang} onClose=${() => setRoom(null)} />`}
  </div>`;
}
