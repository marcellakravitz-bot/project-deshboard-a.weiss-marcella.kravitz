"""Read one DXF plan into plain data: texts, room tags, finish-code tags, linework and leader lines.

Written for the Revit exports used on the A. Weiss projects (checked on Cisco Caesarea floor 4):
  * units are centimetres (INSUNITS 5); other units are scaled to cm
  * a room tag is a "...Tags_Room..." block on the *AREA-IDEN layer plus loose MTEXT fragments around it
    (number, name, area, "sqm")
  * a finish tag is split into fragments on one baseline ("FL-" "1" "c")  -> joined to "FL-1c"
  * elevation markers such as "420.1" are not room numbers
  * linked Revit models are block references on layer 0; their linework closes rooms on the facade
Nothing here guesses: what cannot be read is reported as a warning, never filled in.
"""
import math
import re
import time
from collections import Counter, defaultdict

import ezdxf
from ezdxf import disassemble, recover
from ezdxf import path as zpath

ROOM_NO = re.compile(r"^\d{3}[A-Za-z]?$")          # 421, 404b  — not 420.1 (elevation marker)
NUMBER = re.compile(r"^\d+(\.\d+)?$")
CODE_PREFIXES = ("FL", "FN", "CL")
CODE_RE = re.compile(r"^(FL|FN|CL)-?\d+[A-Za-z]?$", re.I)

WALL_LAYERS = {"A-WALL", "I-WALL", "A-GLAZ-CWMG", "A-GLAZ-CURT", "A-DOOR-OPNG", "A-DOOR", "S-STRS"}
BOUNDARY_EXTRA_LAYERS = {"0", "A-AREA"}             # linked models + room separation lines
WALL_FILL_LAYERS = {"A-WALL-PATT"}
# inside a linked model (block on layer 0) only these layers bound rooms; MEP, furniture and fixtures do not
LINK_KEEP = ("A-WALL", "A-GLAZ", "A-DOOR", "S-COLS", "S-STRS", "A-AREA", "I-WALL")
UNIT_TO_CM = {0: 1.0, 1: 2.54, 2: 30.48, 4: 0.1, 5: 1.0, 6: 100.0}


def _segs(e, flat=2.0):
    t = e.dxftype()
    if t == "LINE":
        s, f = e.dxf.start, e.dxf.end
        return [(s[0], s[1], f[0], f[1])]
    if t in ("LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "SPLINE", "ELLIPSE"):
        try:
            v = list(zpath.make_path(e).flattening(flat))
            return [(v[i][0], v[i][1], v[i + 1][0], v[i + 1][1]) for i in range(len(v) - 1)]
        except Exception:
            return []
    return []


def _hatch_rings(h):
    rings = []
    for p in h.paths:
        try:
            if getattr(p, "vertices", None):
                rings.append([(v[0], v[1]) for v in p.vertices])
            else:
                pts = []
                for ed in p.edges:
                    n = type(ed).__name__
                    if n == "LineEdge":
                        pts += [ed.start, ed.end]
                    elif hasattr(ed, "center"):
                        pts.append(ed.center)
                rings.append([(q[0], q[1]) for q in pts])
        except Exception:
            pass
    return [r for r in rings if len(r) >= 2]


def load(path):
    """Open a DXF. A damaged file is opened in recover mode and the damage is reported, not hidden."""
    warnings = []
    try:
        doc = ezdxf.readfile(path)
    except ezdxf.DXFStructureError as ex:
        doc, auditor = recover.readfile(path)
        warnings.append(f"קובץ ה-DXF פגום ונפתח במצב שחזור: {ex}")
        if auditor.has_errors:
            warnings.append(f"שחזור: {len(auditor.errors)} שגיאות, {len(auditor.fixes)} תיקונים")
    return doc, warnings


def read(path):
    t0 = time.time()
    doc, warnings = load(path)
    msp = doc.modelspace()
    units = doc.header.get("$INSUNITS", 0)
    k = UNIT_TO_CM.get(units)
    if k is None:
        warnings.append(f"יחידות לא מוכרות (INSUNITS={units}) — טופלו כס\"מ")
        k = 1.0
    S = lambda v: round(v * k, 1)

    layers = defaultdict(Counter)
    texts, inserts, segs, leaders, fill_rings = [], [], defaultdict(list), defaultdict(list), []
    picked = []
    for e in msp:
        t, L = e.dxftype(), e.dxf.layer
        layers[L][t] += 1
        try:
            if t in ("TEXT", "MTEXT"):
                s = e.dxf.text if t == "TEXT" else e.plain_text()
                texts.append({"layer": L, "t": s.strip(), "x": S(e.dxf.insert[0]), "y": S(e.dxf.insert[1])})
            elif t == "INSERT":
                inserts.append({"layer": L, "name": e.dxf.name, "x": S(e.dxf.insert[0]), "y": S(e.dxf.insert[1]),
                                "att": {a.dxf.tag: a.dxf.text for a in e.attribs}})
                for a in e.attribs:   # tags drawn as block attributes are texts too
                    texts.append({"layer": a.dxf.layer, "t": a.dxf.text.strip(), "x": S(a.dxf.insert[0]), "y": S(a.dxf.insert[1])})
            elif t == "HATCH" and L in WALL_FILL_LAYERS:
                for r in _hatch_rings(e):
                    fill_rings.append([(S(x), S(y)) for x, y in r])
            if L in WALL_LAYERS or L in BOUNDARY_EXTRA_LAYERS:
                picked.append(e)
            if L.endswith("-IDEN") and t in ("LINE", "LWPOLYLINE", "POLYLINE"):
                for s in _segs(e):
                    leaders[L].append(tuple(S(c) for c in s))
        except Exception:                # one bad entity never stops the file
            layers[L]["_error"] += 1

    for top in picked:
        L = top.dxf.layer
        is_link = L == "0" and top.dxftype() == "INSERT"
        try:
            subs = disassemble.recursive_decompose([top]) if top.dxftype() == "INSERT" else [top]
            for e in subs:
                if is_link:
                    sl = e.dxf.layer.upper()
                    if not sl.startswith(LINK_KEEP):
                        continue
                    if e.dxftype() == "HATCH" and sl.startswith("A-WALL"):
                        for r in _hatch_rings(e):
                            fill_rings.append([(S(x), S(y)) for x, y in r])
                        continue
                for s in _segs(e):
                    segs[L].append(tuple(S(c) for c in s))
        except Exception:
            warnings.append(f"לא ניתן היה לקרוא ישות בשכבה {L}")

    ext = [doc.header.get("$EXTMIN"), doc.header.get("$EXTMAX")]
    integrity = {
        "acadver": doc.header.get("$ACADVER"), "units": units, "codepage": doc.header.get("$DWGCODEPAGE"),
        "layers": len(layers), "texts": len(texts), "inserts": len(inserts),
        "wall_segments": sum(len(v) for L, v in segs.items() if L in WALL_LAYERS),
        "link_segments": sum(len(v) for L, v in segs.items() if L in BOUNDARY_EXTRA_LAYERS),
        "errors": sum(c.get("_error", 0) for c in layers.values()),
        "extents_cm": [[S(ext[0][0]), S(ext[0][1])], [S(ext[1][0]), S(ext[1][1])]] if ext[0] and ext[1] else None,
        "load_sec": round(time.time() - t0),
    }
    if not texts:
        warnings.append("אין טקסט בשרטוט — הקודים ותוויות החדרים ייקראו מה-PDF")
    if integrity["wall_segments"] == 0:
        warnings.append("לא נמצאו קווי קירות בשכבות הצפויות")
    return {"texts": texts, "inserts": inserts, "segments": {L: v for L, v in segs.items()},
            "leaders": {L: v for L, v in leaders.items()}, "wall_fill": fill_rings,
            "layers": {L: dict(c) for L, c in layers.items()}, "integrity": integrity, "warnings": warnings}


# --------------------------------------------------------------------------- room tags
def room_tags(d, radius=60.0):
    """Rebuild each room tag from its block anchor and the loose fragments around it."""
    is_area = lambda L: "AREA-IDEN" in L.upper()
    anchors = [i for i in d["inserts"] if is_area(i["layer"]) and "ROOM" in i["name"].upper()]
    frags = [t for t in d["texts"] if is_area(t["layer"]) and t["t"]]
    groups, orphans = defaultdict(list), []
    for f in frags:
        best = min(range(len(anchors)), key=lambda k: math.hypot(f["x"] - anchors[k]["x"], f["y"] - anchors[k]["y"]), default=None)
        if best is not None and math.hypot(f["x"] - anchors[best]["x"], f["y"] - anchors[best]["y"]) <= radius:
            groups[best].append(f)
        else:
            orphans.append(f)
    tags = []
    for k, a in enumerate(anchors):
        g = groups[k]
        nums = [f for f in g if ROOM_NO.match(f["t"])]
        area = None
        for f in g:
            if f["t"].lower() == "sqm":
                left = [h for h in g if abs(h["y"] - f["y"]) < 1 and h["x"] < f["x"] and NUMBER.match(h["t"])]
                if left:
                    area = float(sorted(left, key=lambda h: h["x"])[-1]["t"])
        name = " ".join(f["t"] for f in sorted(g, key=lambda f: (-f["y"], f["x"]))
                        if not ROOM_NO.match(f["t"]) and f["t"].lower() != "sqm" and not NUMBER.match(f["t"]))
        if nums:
            tags.append({"room": nums[0]["t"], "name": name.strip(), "area": area, "anchor": (a["x"], a["y"]),
                         "number_pos": (nums[0]["x"], nums[0]["y"]), "extra_numbers": [n["t"] for n in nums[1:]]})
    # a number with no tag block at all (tag exported as plain text) — only if it looks like this floor's numbers
    tagged = {t["room"] for t in tags}
    lead = Counter(t["room"][0] for t in tags).most_common(1)
    for f in orphans:
        if ROOM_NO.match(f["t"]) and f["t"] not in tagged and (not lead or f["t"][0] == lead[0][0]):
            tags.append({"room": f["t"], "name": "", "area": None, "anchor": (f["x"], f["y"]), "number_pos": (f["x"], f["y"]),
                         "extra_numbers": [], "no_block": True})
            tagged.add(f["t"])
    loose_names = [f for f in orphans if not NUMBER.match(f["t"]) and not ROOM_NO.match(f["t"]) and len(f["t"]) > 1]
    return tags, loose_names


# --------------------------------------------------------------------------- finish codes
def code_tags(d, gap=35.0):
    """Join split tag fragments on one baseline: "FL-" "1" "c" -> "FL-1c". The letter case is kept as drawn."""
    by_layer = defaultdict(list)
    for t in d["texts"]:
        if t["t"] and "AREA-IDEN" not in t["layer"].upper():
            by_layer[t["layer"]].append(t)
    out = []
    for L, frags in by_layer.items():
        frags.sort(key=lambda t: (round(t["y"]), t["x"]))
        used = [False] * len(frags)
        for i, f in enumerate(frags):
            up = f["t"].upper()
            if used[i] or not up.startswith(CODE_PREFIXES):
                continue
            used[i] = True
            text, x_end, parts = f["t"], f["x"], 1
            for j, g in enumerate(frags):
                if used[j] or abs(g["y"] - f["y"]) > 1.0 or g["x"] <= f["x"] or g["x"] - x_end > gap:
                    continue
                if g["t"].upper().startswith(CODE_PREFIXES):
                    continue
                used[j] = True
                text += g["t"]; x_end = g["x"]; parts += 1
            code = text.replace(" ", "")
            if CODE_RE.match(code):
                out.append({"code": code, "kind": code[:2].upper(), "x": f["x"], "y": f["y"], "layer": L, "parts": parts})
    return out


def leader_lines(d, min_len=12.0):
    out = []
    for L, segs in d["leaders"].items():
        out += [s for s in segs if math.hypot(s[2] - s[0], s[3] - s[1]) > min_len]
    return out


def content_hint(d):
    """What the drawing itself says it is (used to confirm the plan type chosen at upload)."""
    kinds = Counter(c["kind"] for c in code_tags(d))
    layers = d["layers"]
    if kinds:
        return kinds.most_common(1)[0][0], dict(kinds)
    if any("CLNG" in L.upper() or "CEIL" in L.upper() for L in layers):
        return "CL", {}
    return None, {}
