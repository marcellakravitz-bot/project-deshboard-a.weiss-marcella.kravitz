"""Cross-check a plan set that has no usable DXF: rooms and marks read from the PDF sheets alone.

Used when no DXF of the set carries room tags (no DXF at all, or a DXF converted from a PDF, whose text is
broken into single letters). The base sheet is the one with the most room tags; every other sheet is placed on it
by the room numbers they share. Without walls there are no room boundaries: a mark belongs to the room whose tag
is nearest, and is never "certain" unless two sheets agree. The phone map is a light picture of the base sheet.
"""
import math
import re
from collections import Counter, defaultdict

from . import align

KINDS = ("FL", "FN", "CL")
PLAN_KIND = {"FL": "FL", "FN": "FN", "CL": "CL", "JOIN": "joinery", "LIGHT": "lighting", "SAN": "plumbing"}
CODE_RE = re.compile(r"^([A-Za-z]{1,4})[-.]?(\d{1,3}[A-Za-z]?)$")


def canon(code):
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def _prefix(code):
    m = CODE_RE.match(code or "")
    return m.group(1).upper() if m else None


class PdfFloor:
    """Rooms as points (their tags), in the base sheet's coordinates (PDF points, y down)."""

    def __init__(self, tags, box):
        self.tags = tags
        self.box = box
        pts = [(t["x"], t["y"]) for t in tags.values()]
        nn = sorted(min(math.hypot(a[0] - b[0], a[1] - b[1]) for b in pts if b is not a) for a in pts) if len(pts) > 1 else [200.0]
        self.reach = 2.2 * nn[len(nn) // 2]            # a mark further than this from every tag belongs to no room

    def inside(self, x, y):
        b = self.box
        return b is None or (b[0] <= x <= b[2] and b[1] <= y <= b[3])

    def place(self, x, y):
        d = sorted((math.hypot(t["x"] - x, t["y"] - y), n) for n, t in self.tags.items())
        if not d or d[0][0] > self.reach:
            return None, "unassigned", "רחוק מכל תווית חדר"
        if len(d) > 1 and d[1][0] < 1.25 * d[0][0] and d[1][1] != d[0][1]:
            return None, "review", f"בין החדרים {d[0][1]} ו-{d[1][1]} — אין גבולות חדרים ב-PDF"
        return d[0][1], "estimated", f"לפי תווית החדר הקרובה ({d[0][0]:.0f} נק׳) — אין גבולות חדרים ב-PDF"


def _floor_digit(pages, set_floor):
    if set_floor and str(set_floor).strip().isdigit():
        return str(int(set_floor))[-1] if len(str(int(set_floor))) == 1 else None
    firsts = Counter(t["room"][0] for p in pages for t in p.get("tags", []) if t.get("area") is not None)
    return firsts.most_common(1)[0][0] if firsts else None


def run(files, current, set_meta, defined, item_api):
    """item_api: (current_value, same) from crosscheck, so both modes judge changes the same way."""
    current_value, same = item_api
    warnings, sources, views, items = [], [], [], []
    pdfs = [f for f in files if f["format"] == "pdf" and f["data"].get("page")]
    rvts = [f for f in files if f["format"] == "rvt"]
    dxfs = [f for f in files if f["format"] == "dxf"]
    for f in dxfs:
        warnings.append(f"{f['name']}: אין ב-DXF תוויות חדרים שאפשר לקרוא"
                        + (" — נראה שהוא הומר מ-PDF (הטקסט מפורק לאותיות). הקריאה נעשתה מקובצי ה-PDF." if f["data"].get("converted_from_pdf") else "."))
    if not pdfs:
        return None
    floor_d = _floor_digit([f["data"]["page"] for f in pdfs], (set_meta or {}).get("floor"))
    is_room = lambda n: bool(re.match(r"^\d{3}[A-Za-z]?$", n)) and (floor_d is None or n.startswith(floor_d))

    def room_tags(f):
        out = {}
        for t in f["data"]["page"].get("tags", []):
            if is_room(t["room"]) and t["room"] not in out:
                out[t["room"]] = t
        return out

    base = max(pdfs, key=lambda f: (sum(t.get("area") is not None for t in room_tags(f).values()), len(room_tags(f)), f["plan_type"] == "FL"))
    btags = room_tags(base)
    if len(btags) < 3:
        warnings.append("לא נמצאו בגיליונות מספרי חדרים של הקומה — אין על מה להצליב")
        return {"items": [], "sources": [], "views": [], "map": None, "warnings": warnings, "summary": {}}
    F = PdfFloor(btags, base["data"]["page"].get("plan_box"))
    warnings.append(f"אין DXF עם תוויות חדרים — החדרים נקראו מ-PDF ({base['name']}); השיוך לחדרים לפי מיקום, בלי גבולות")

    # ---------------------------------------------------------------- place every sheet on the base sheet
    placed = {base["id"]: None}
    for f in pdfs:
        if f is base:
            continue
        nums = [{"room": t["room"], "x": t["x"], "y": t["y"]} for t in room_tags(f).values()]
        fit = align.by_numbers({n: (t["x"], t["y"]) for n, t in btags.items()}, nums, tol=8.0)
        if not fit:
            warnings.append(f"{f['name']}: לא ניתן למקם את הגיליון על גיליון הבסיס (מעט מדי מספרי חדרים משותפים)")
            continue
        placed[f["id"]] = fit
        views.append({"file_id": f["id"], "page": f["data"]["page"]["page"], "transform": fit["M"], "method": "room numbers (PDF)",
                      "fit_error": fit["fit_error_pt"], "page_size": [f["data"]["page"]["width"], f["data"]["page"]["height"]]})
    to_base = {fid: (align.invert(fit["M"]) if fit else (lambda x, y: (x, y))) for fid, fit in placed.items()}

    # ---------------------------------------------------------------- marks
    inst = []
    for f in pdfs:
        if f["id"] not in placed:
            continue
        page = f["data"]["page"]
        tr = to_base[f["id"]]
        found = []
        for c in (page.get("codes") or []) + (page.get("marks") or []):
            x, y = tr(c["x"], c["y"])
            if F.inside(x, y):
                found.append((c, x, y))
        # the sheet's own codes: the prefix that repeats on a flooring / finishes / ceiling ... sheet is that sheet's mark
        own = None
        if f["plan_type"] in PLAN_KIND:
            pc = Counter(_prefix(c["code"]) for c, _, _ in found if _prefix(c["code"]))
            if pc and pc.most_common(1)[0][1] >= 3:
                own = pc.most_common(1)[0][0]
        for c, x, y in found:
            d = defined.get(canon(c["code"]))
            if d:
                code, kind = d
            elif c["code"][:2].upper() in KINDS and re.match(r"^(FL|FN|CL)-?\d", c["code"], re.I):
                code, kind = c["code"], c["code"][:2].upper()
            elif own and _prefix(c["code"]) == own:
                code, kind = c["code"].upper(), PLAN_KIND[f["plan_type"]]
            else:
                continue
            n, conf, how = F.place(x, y)
            inst.append({"file": f, "kind": kind, "code": code, "room": n, "conf": conf, "how": how, "x": round(x, 1), "y": round(y, 1)})
    for i in inst:
        sources.append({"file_id": i["file"]["id"], "room_no": i["room"], "field": i["kind"], "value": i["code"],
                        "x": i["x"], "y": i["y"], "method": i["how"], "confidence": i["conf"]})
    kinds = sorted({i["kind"] for i in inst}, key=lambda k: (k not in KINDS, k))

    # ---------------------------------------------------------------- RVT (confirms names, never adds rooms here)
    rvt_rooms = {}
    if rvts:
        for x in rvts[-1]["data"].get("rooms", []):
            if x["room"] in btags:
                rvt_rooms[x["room"]] = x

    # ---------------------------------------------------------------- per room
    tags_by_file = {f["id"]: room_tags(f) for f in pdfs if f["id"] in placed}

    def item(no, field, proposed, status, srcs, note=None, rvt=False):
        cur = current.get(no)
        cv = current_value(cur, field)
        change = "new" if cur is None else ("same" if same(field, cv, proposed) else "changed")
        items.append({"room_no": no, "field": field, "proposed": proposed, "current": cv, "change_type": change,
                      "status": status, "rvt_verified": rvt, "sources": srcs, "note": note,
                      "decision": "unchanged" if change == "same" else "pending"})

    all_rooms = sorted(set().union(*[set(t) for t in tags_by_file.values()]),
                       key=lambda n: (int(re.match(r"\d+", n).group(0)), n))
    for no in all_rooms:
        seen = [(fid, t[no]) for fid, t in tags_by_file.items() if no in t]
        fname = {f["id"]: f["name"] for f in pdfs}
        srcs = [{"src": "PDF", "file": fname[fid], "how": "תווית חדר בגיליון"} for fid, _ in seen]
        rv = rvt_rooms.get(no)
        if rv:
            srcs.append({"src": "RVT", "file": rvts[-1]["name"], "how": f"חדר במודל ({rv['name']})"})
        item(no, "room", {"value": no}, "certain" if len(seen) >= 2 else "single", srcs,
             None if len(seen) >= 2 else "מופיע בגיליון אחד בלבד", rvt=bool(rv))
        names = [(fid, t["name"]) for fid, t in seen if t.get("name")]
        if names:
            cnt = Counter(re.sub(r"\s+", " ", n).strip().lower() for _, n in names)
            best = max(names, key=lambda p: cnt[re.sub(r"\s+", " ", p[1]).strip().lower()])[1]
            st = "certain" if len(cnt) == 1 and len(names) >= 2 else ("conflict" if len(cnt) > 1 else "estimated")
            rvt_ok = bool(rv and rv.get("name") and rv["name"].strip().lower() == best.strip().lower())
            if rvt_ok and st == "estimated":
                st = "certain"
            item(no, "name", {"value": best}, st, [{"src": "PDF", "file": fname[fid], "how": "שם בתווית החדר", "value": n} for fid, n in names],
                 None if st != "conflict" else "שמות שונים בגיליונות: " + " / ".join(sorted({n for _, n in names})), rvt=rvt_ok)
        areas = [(fid, t["area"]) for fid, t in seen if t.get("area") is not None]
        if areas:
            vals = sorted({a for _, a in areas})
            item(no, "area", {"value": vals[0]}, "certain" if len(vals) == 1 and len(areas) >= 2 else ("conflict" if len(vals) > 1 else "estimated"),
                 [{"src": "PDF", "file": fname[fid], "how": "שטח בתווית החדר", "value": a} for fid, a in areas],
                 None if len(vals) == 1 else "שטחים שונים בגיליונות: " + ", ".join(str(v) for v in vals))
        t = btags.get(no) or seen[0][1]
        item(no, "boundary", {"poly": None, "x": round(t["x"], 1), "y": round(t["y"], 1)}, "missing",
             [{"src": "PDF", "file": base["name"], "how": "מיקום תווית החדר"}], "אין גבול — החדר מוצג כנקודה (תוכניות PDF בלבד)")
        for k in kinds:
            mine = [i for i in inst if i["room"] == no and i["kind"] == k]
            had = (current_value(current.get(no), k) or {}).get("codes") or []
            if not mine:
                if had:
                    item(no, k, {"codes": [], "alternatives": {}}, "missing", [], "אושר בעבר, ולא נמצא בגיליונות של הגרסה הזו")
                continue
            by_file = defaultdict(set)
            for i in mine:
                by_file[i["file"]["name"]].add(i["code"])
            codes = sorted({i["code"] for i in mine})
            agree = len(by_file) >= 2 and len({tuple(sorted(v)) for v in by_file.values()}) == 1
            st = "certain" if agree else ("conflict" if len(by_file) >= 2 else "estimated")
            item(no, k, {"codes": codes, "alternatives": {fn: sorted(v) for fn, v in by_file.items()}}, st,
                 [{"src": "PDF", "file": i["file"]["name"], "value": i["code"], "how": i["how"], "confidence": i["conf"]} for i in mine],
                 None if st != "conflict" else "גיליונות שונים נותנים קודים שונים")
    for no, cur in current.items():
        if cur.get("status") == "active" and no not in all_rooms:
            items.append({"room_no": no, "field": "room", "proposed": {"value": None}, "current": {"value": no}, "change_type": "removed",
                          "status": "missing", "rvt_verified": False, "sources": [], "note": "אושר בעבר, ולא נמצא באף גיליון בגרסה הזו",
                          "decision": "pending"})

    # ---------------------------------------------------------------- phone map: a picture of the base sheet + a dot per room
    pv = base["data"]["page"].get("preview")
    box = pv["bbox"] if pv else F.box or [0, 0, base["data"]["page"]["width"], base["data"]["page"]["height"]]
    fmap = {"w": round(box[2] - box[0]), "h": round(box[3] - box[1]), "walls": "", "fs": 9, "focus": 260,
            "image": pv["img"] if pv else None,
            "rooms": [{"n": n, "d": None, "x": round(t["x"] - box[0], 1), "y": round(t["y"] - box[1], 1)} for n, t in btags.items()]}
    unassigned = sum(1 for i in inst if not i["room"])
    if unassigned:
        warnings.append(f"{unassigned} קודים בגיליונות לא שויכו לחדר (רחוקים מכל תווית או בין שני חדרים) — הם מופיעים במקורות לבדיקה")
    summary = {"mode": "pdf", "rooms": len(all_rooms), "items": len(items), "mark_kinds": kinds, "placed_pdfs": len(placed),
               "status": dict(Counter(i["status"] for i in items)), "changes": dict(Counter(i["change_type"] for i in items))}
    return {"items": items, "sources": sources, "views": views, "map": fmap, "warnings": warnings, "summary": summary}
