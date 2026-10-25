"""Cross-check all files of one plan set and propose one result per room and field.

Rules (agreed in the By Room specification):
  * DXF + PDF are the working sources; RVT only confirms or questions, it never overrides them
  * every value keeps its sources; nothing is filled in without saying how it was found
  * statuses: certain / estimated / conflict / missing / single (found in one source only)
  * a room with no closed boundary gets no invented boundary
  * a wall tag on a shared wall is assigned by its leader line, not by distance alone
  * PDF and DXF of different dates are flagged
Nothing here writes to the approved data: the output is review rows the administrator ticks.
"""
import math
import re
from collections import Counter, defaultdict

from shapely.geometry import Point, Polygon

from . import align

KINDS = ("FL", "FN", "CL")
CONF = {"certain": "certain", "estimated": "estimated", "review": "review", "unassigned": "unassigned"}


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _floor_pattern(numbers):
    firsts = Counter(n[0] for n in numbers if len(n) >= 3 and n[0].isdigit())
    if not firsts:
        return None
    p = firsts.most_common(1)[0][0]
    return re.compile(rf"^{p}\d{{2}}[A-Za-z]?$")


class Floor:
    """Rooms of the base drawing, with the placement rules for anything found on the sheet."""

    def __init__(self, base):
        self.tags = {t["room"]: t for t in base["tags"]}
        self.rooms = {}
        for no, t in self.tags.items():
            b = base["boundaries"].get(no) or {}
            poly = Polygon(b["poly"]) if b.get("poly") else None
            self.rooms[no] = {"tag": t, "poly": poly, "grade": b.get("grade", "none"), "geom_area": b.get("geom_area"),
                              "anchor": Point(t["anchor"])}
        polys = [r["poly"] for r in self.rooms.values() if r["poly"] is not None]
        xs = [p.bounds for p in polys] or [(t["anchor"][0], t["anchor"][1], t["anchor"][0], t["anchor"][1]) for t in self.tags.values()]
        self.bbox = (min(b[0] for b in xs) - 400, min(b[1] for b in xs) - 400, max(b[2] for b in xs) + 400, max(b[3] for b in xs) + 400)

    def in_bbox(self, x, y):
        b = self.bbox
        return b[0] <= x <= b[2] and b[1] <= y <= b[3]

    def _no_boundary_room(self, p):
        d = sorted((r["anchor"].distance(p), n) for n, r in self.rooms.items() if r["poly"] is None)
        if d and d[0][0] <= 350 and (len(d) == 1 or d[1][0] > 1.5 * d[0][0]):
            return d[0][1], d[0][0]
        return None, None

    def place(self, x, y, kind, leader=None, edge_tol=0.0):
        """Which room a tag at (x, y) belongs to -> (room, confidence, how)."""
        p = Point(x, y)
        inside = [(n, r["poly"].exterior.distance(p)) for n, r in self.rooms.items() if r["poly"] is not None and r["poly"].contains(p)]
        if len(inside) == 1:
            n, depth = inside[0]
            if depth < edge_tol:
                return n, "estimated", f"בתוך החדר, {depth:.0f} ס\"מ מהקיר — בטווח אי-הוודאות של יישור הגיליון"
            return n, "certain", "בתוך גבול החדר"
        if kind == "FN" and leader is not None:
            n, why = self._room_at_wall(*leader)
            if n:
                return n, "estimated", why
            if why:
                return None, "review", why
        if kind != "FN":
            near = sorted((r["poly"].exterior.distance(p), n) for n, r in self.rooms.items() if r["poly"] is not None)
            near = [q for q in near if q[0] <= 60]
            if len(near) == 1:
                return near[0][1], "estimated", f"{near[0][0]:.0f} ס\"מ מחוץ לגבול החדר"
            if len(near) > 1:
                return None, "review", "על הקיר בין " + " ל-".join(n for _, n in near[:2])
        n, d = self._no_boundary_room(p)
        if n:
            return n, "estimated", f"לחדר אין גבול סגור — לפי תווית החדר הקרובה ({d:.0f} ס\"מ)"
        return None, "unassigned", "מחוץ לכל חדר שזוהה (אזור פתוח / מסדרון)"

    def _room_at_wall(self, tx, ty):
        p = Point(tx, ty)
        d = sorted((0.0 if r["poly"].contains(p) else r["poly"].exterior.distance(p), n) for n, r in self.rooms.items() if r["poly"] is not None)
        if not d or d[0][0] > 20:
            return None, None
        if len(d) > 1 and d[1][0] - d[0][0] < 4:
            return None, f"קו המוביל נוגע בקיר בין {d[0][1]} ל-{d[1][1]}"
        return d[0][1], f"לפי קו המוביל — מצביע על קיר החדר ({d[0][0]:.0f} ס\"מ)"


def leader_target(leaders, x, y):
    """Far end of the leader that starts at a tag (the tag centre sits ~14 cm right of the text start)."""
    cx, cy = x + 14, y + 3
    best = None
    for q in leaders:
        for ax, ay, bx, by in ((q[0], q[1], q[2], q[3]), (q[2], q[3], q[0], q[1])):
            if math.hypot(ax - cx, ay - cy) < 35:
                L = math.hypot(bx - ax, by - ay)
                if best is None or L > best[2]:
                    best = (bx, by, L)
    return best[:2] if best else None


def run(files, current=None, set_meta=None):
    """files: [{"id","plan_type","format","name","data"}]; current: approved rooms {room_no: {...}}."""
    current = current or {}
    warnings, sources, views = [], [], []
    dxfs = [f for f in files if f["format"] == "dxf"]
    pdfs = [f for f in files if f["format"] == "pdf"]
    rvts = [f for f in files if f["format"] == "rvt"]

    with_tags = [f for f in dxfs if f["data"].get("tags")]
    base = next((f for f in with_tags if f["plan_type"] == "FL"), None) or next((f for f in with_tags if f["plan_type"] == "FN"), None) \
        or (with_tags[0] if with_tags else None)
    if base is None:
        return {"items": [], "sources": [], "views": [], "map": None, "warnings": ["אין בגרסה DXF עם תוויות חדרים — אין על מה להצליב"],
                "summary": {}}
    F = Floor(base["data"])
    pattern = _floor_pattern(list(F.tags))

    # ---------------------------------------------------------------- place every PDF on the DXF
    placed = {}
    polys = {n: r["poly"] for n, r in F.rooms.items() if r["poly"] is not None and r["grade"] == "match"}
    for f in sorted(pdfs, key=lambda f: f["plan_type"] == "CL"):      # sheets with tags first, their scale helps the others
        page = f["data"].get("page")
        if not page or not page["numbers"]:
            warnings.append(f"{f['name']}: אין בגיליון מספרי חדרים, ולכן אי אפשר למקם אותו על התוכנית")
            continue
        # each view places its tags differently: use the tag positions of the DXF of the same plan first
        # (all DXFs of a floor share one coordinate system, so the result is valid on the base drawing too)
        fit = None
        for cand in [f2 for f2 in with_tags if f2["plan_type"] == f["plan_type"]] + [base]:
            pos = {t["room"]: t["number_pos"] for t in cand["data"]["tags"]}
            fit = align.by_numbers(pos, page["numbers"])
            if fit and fit["fit_error_cm"] <= 40:
                break
        if fit is None or fit["fit_error_cm"] > 40:
            known = [v["scale"] for v in placed.values()]
            fit2 = align.by_rooms(polys, page["numbers"], page["width"], page["height"], known + align.STANDARD_SCALES)
            fit = fit2 or fit
        if fit is None:
            warnings.append(f"{f['name']}: לא ניתן למקם את הגיליון על ה-DXF — הקודים שבו לא שויכו לחדרים")
            continue
        placed[f["id"]] = fit
        views.append({"file_id": f["id"], "page": page["page"], "transform": fit["M"], "method": fit["method"],
                      "fit_error": fit["fit_error_cm"], "page_size": [page["width"], page["height"]]})

    # ---------------------------------------------------------------- finish code instances
    inst = []
    for f in dxfs:
        leaders = f["data"].get("leaders") or []
        for c in f["data"].get("codes", []):
            lead = leader_target(leaders, c["x"], c["y"]) if c["kind"] == "FN" else None
            n, conf, how = F.place(c["x"], c["y"], c["kind"], leader=lead)
            inst.append({"file": f, "src": "DXF", "kind": c["kind"], "code": c["code"], "room": n, "conf": conf, "how": how,
                         "x": c["x"], "y": c["y"]})
    for f in pdfs:
        fit = placed.get(f["id"])
        if not fit:
            continue
        inv = align.invert(fit["M"])
        tol = max(30.0, 2 * fit["fit_error_cm"]) if fit["method"] != "room numbers" else 0.0
        dxf_same = [i for i in inst if i["src"] == "DXF"]
        for c in f["data"]["page"]["codes"]:
            x, y = inv(c["x"], c["y"])
            if not F.in_bbox(x, y):
                continue                        # the finish schedule / legend, not a tag on the plan
            lead = None
            if c["kind"] == "FN":                # borrow the leader of the DXF tag at the same spot
                twin = min((i for i in dxf_same if i["kind"] == "FN"), key=lambda i: math.hypot(i["x"] - x, i["y"] - y), default=None)
                if twin and math.hypot(twin["x"] - x, twin["y"] - y) < 45:
                    lead = leader_target(twin["file"]["data"].get("leaders") or [], twin["x"], twin["y"])
            n, conf, how = F.place(x, y, c["kind"], leader=lead, edge_tol=tol)
            if c.get("flag"):
                conf = "estimated" if conf == "certain" else conf
                how += "; " + c["flag"]
            inst.append({"file": f, "src": "PDF", "kind": c["kind"], "code": c["code"], "room": n, "conf": conf, "how": how,
                         "x": round(x, 1), "y": round(y, 1)})
    # same tag, two files: what does the PDF print where the DXF has a tag?
    for i in inst:
        if i["src"] != "DXF":
            continue
        twins = [j for j in inst if j["src"] == "PDF" and j["kind"] == i["kind"] and math.hypot(j["x"] - i["x"], j["y"] - i["y"]) < 45]
        i["pdf_same_spot"] = min(twins, key=lambda j: math.hypot(j["x"] - i["x"], j["y"] - i["y"]))["code"] if twins else None

    for i in inst:
        sources.append({"file_id": i["file"]["id"], "room_no": i["room"], "field": i["kind"], "value": i["code"],
                        "x": i["x"], "y": i["y"], "method": i["how"], "confidence": CONF[i["conf"]]})

    # ---------------------------------------------------------------- RVT
    rvt_rooms = {}
    if rvts:
        r = rvts[-1]["data"]
        for x in r.get("rooms", []):
            if x["room"] in F.tags or (pattern and pattern.match(x["room"]) and F.in_bbox(x["x"], x["y"])):
                rvt_rooms[x["room"]] = x
        shared = [n for n in F.tags if n in rvt_rooms]
        if F.tags and len(shared) < 0.9 * len(F.tags):
            warnings.append(f"RVT: רק {len(shared)} מתוך {len(F.tags)} חדרים נמצאו במודל — ה-RVT לא שימש בגרסה הזו")
            rvt_rooms = {}
        for no, x in rvt_rooms.items():
            sources.append({"file_id": rvts[-1]["id"], "room_no": no, "field": "location", "value": x["name"], "x": x["x"], "y": x["y"],
                            "method": "חדר במודל Revit", "confidence": "certain"})

    # ---------------------------------------------------------------- PDF room numbers
    pdf_numbers = defaultdict(list)
    for f in pdfs:
        if f["plan_type"] == "CL":
            continue          # ceiling sheets also print heights (280, 460...) — not used to say a room exists
        fit = placed.get(f["id"])
        if not fit:
            continue
        inv = align.invert(fit["M"])
        for n in f["data"]["page"]["numbers"]:
            x, y = inv(n["x"], n["y"])
            if F.in_bbox(x, y):
                pdf_numbers[n["room"]].append((f, x, y))

    # ---------------------------------------------------------------- dates
    dates = {f["name"]: f.get("file_date") for f in files if f.get("file_date")}
    if len(set(dates.values())) > 1:
        warnings.append("בגרסה יש קבצים מתאריכים שונים: " + ", ".join(f"{k}: {v}" for k, v in dates.items()))

    # ---------------------------------------------------------------- per room
    items = []
    other_tags = {f["id"]: {t["room"]: t for t in f["data"]["tags"]} for f in with_tags if f is not base}
    have_dxf_codes = {k: any(i["src"] == "DXF" and i["kind"] == k for i in inst) for k in KINDS}
    have_pdf = {k: any(f["plan_type"] == k for f in pdfs if f["id"] in placed) for k in KINDS}
    have_dxf_plan = {k: any(f["plan_type"] == k for f in dxfs) for k in KINDS}

    def item(no, field, proposed, status, sources_, note=None, rvt=False):
        cur = current.get(no)
        cur_val = _current_value(cur, field)
        change = "new" if cur is None else ("same" if _same(field, cur_val, proposed) else "changed")
        items.append({"room_no": no, "field": field, "proposed": proposed, "current": cur_val, "change_type": change,
                      "status": status, "rvt_verified": rvt, "sources": sources_, "note": note,
                      "decision": "unchanged" if change == "same" else "pending"})

    all_numbers = sorted(set(F.tags) | set(rvt_rooms) | {n for n in pdf_numbers if pattern is None or pattern.match(n)}, key=_room_key)
    for no in all_numbers:
        in_dxf, in_pdf, rv = no in F.tags, no in pdf_numbers, rvt_rooms.get(no)
        r = F.rooms.get(no)
        rvt_inside = bool(rv and r and r["poly"] is not None and r["poly"].buffer(30).contains(Point(rv["x"], rv["y"])))
        rvt_near = bool(rv and r and r["anchor"].distance(Point(rv["x"], rv["y"])) < 400)
        srcs = ([{"src": "DXF", "file": base["name"], "how": "תווית חדר"}] if in_dxf else []) + \
               [{"src": "PDF", "file": f["name"], "how": "מספר חדר בגיליון"} for f in {id(p[0]): p[0] for p in pdf_numbers.get(no, [])}.values()] + \
               ([{"src": "RVT", "file": rvts[-1]["name"], "how": f"חדר במודל ({rv['name']})"}] if rv else [])
        # -- the room itself
        if in_dxf and (in_pdf or not pdfs):
            st = "certain"
        elif in_dxf or in_pdf or rv:
            st = "single" if len({s["src"] for s in srcs}) == 1 else "estimated"
        else:
            continue
        note = None
        if not in_dxf and rv and not in_pdf:
            note = "נמצא רק במודל Revit — לא מתויג בתוכניות הגמר"
        elif not in_dxf and in_pdf:
            note = "מופיע בגיליון ה-PDF ולא ב-DXF — ייתכן שהקבצים מגרסאות שונות"
        item(no, "room", {"value": no}, st, srcs, note, rvt=bool(rv) and (rvt_inside or rvt_near))
        if not in_dxf:
            if rv:
                item(no, "name", {"value": rv["name"]}, "single", [srcs[-1]], "שם מהמודל בלבד")
            continue
        t = r["tag"]
        # -- name
        name, name_st, name_src = t["name"], "certain", [{"src": "DXF", "file": base["name"], "how": "תווית חדר", "value": t["name"]}]
        if not name:
            loose = sorted((math.hypot(o["x"] - t["anchor"][0], o["y"] - t["anchor"][1]), o["t"]) for o in base["data"].get("loose_names", []))
            if loose and loose[0][0] < 150:
                name, name_st = loose[0][1], "estimated"
                name_src = [{"src": "DXF", "file": base["name"], "how": f"שבר טקסט במרחק {loose[0][0]:.0f} ס\"מ מתווית החדר", "value": name}]
        name_note = None
        for fid, tg in other_tags.items():
            o = tg.get(no)
            fn = next(f for f in with_tags if f["id"] == fid)
            if o and o["name"]:
                name_src.append({"src": "DXF", "file": fn["name"], "how": "תווית חדר", "value": o["name"]})
                if name and _norm(o["name"]) != _norm(name):
                    name_st, name_note = "conflict", "שתי תוכניות ה-DXF נותנות לחדר שמות שונים"
        rvt_ok = False
        if rv and rv.get("name"):
            name_src.append({"src": "RVT", "file": rvts[-1]["name"], "how": "חדר במודל", "value": rv["name"]})
            if name and _norm(rv["name"]) == _norm(name):
                rvt_ok = True
            elif name:
                name_st, name_note = "conflict", f"במודל Revit שמו \"{rv['name']}\""
        if rvt_ok and name_st == "estimated":
            name_st, name_note = "certain", "השם אומת במודל Revit"
        if not name:
            name_st = "missing"
        item(no, "name", {"value": name}, name_st, name_src, name_note, rvt=rvt_ok)
        # -- area
        area_src = [{"src": "DXF", "file": base["name"], "how": "השטח שבתווית החדר", "value": t["area"]}]
        area_st, area_note = ("certain" if r["grade"] == "match" else "estimated") if t["area"] is not None else "missing", None
        if r["geom_area"] is not None:
            area_src.append({"src": "DXF", "file": base["name"], "how": "שטח הגבול ששוחזר", "value": r["geom_area"]})
        for fid, tg in other_tags.items():
            o = tg.get(no)
            if o and o["area"] is not None and t["area"] is not None and abs(o["area"] - t["area"]) > 0.5:
                area_st, area_note = "conflict", f"ב-DXF השני כתוב {o['area']} מ\"ר"
        item(no, "area", {"value": t["area"]}, area_st, area_src, area_note)
        # -- boundary
        if r["poly"] is not None:
            c = r["poly"].representative_point()
            st = "certain" if r["grade"] == "match" else "estimated"
            item(no, "boundary", {"poly": [list(p) for p in r["poly"].exterior.coords], "x": round(c.x, 1), "y": round(c.y, 1),
                                  "geom_area": r["geom_area"]}, st,
                 [{"src": "DXF", "file": base["name"], "how": f"שוחזר מהקירות: {r['geom_area']} מ\"ר מול {t['area']} מ\"ר בתווית"}]
                 + ([{"src": "RVT", "file": rvts[-1]["name"], "how": "נקודת החדר במודל נמצאת בתוך הגבול"}] if rvt_inside else []),
                 None if r["grade"] == "match" else "שטח הגבול שונה מהתווית ב-7%–25%", rvt=rvt_inside)
        else:
            x, y = (rv["x"], rv["y"]) if rv else t["anchor"]
            item(no, "boundary", {"poly": None, "x": round(x, 1), "y": round(y, 1)}, "missing",
                 [{"src": "DXF", "file": base["name"], "how": "הקירות לא סוגרים את החדר בקובץ (מודל מקושר / חזית)"}]
                 + ([{"src": "RVT", "file": rvts[-1]["name"], "how": "המיקום אומת במודל Revit"}] if rv else []),
                 "לא הומצא גבול — החדר מוצג כנקודה" + (" (מיקום מהמודל)" if rv else ""),
                 rvt=bool(rv and rvt_near))
        # -- finish codes
        for k in KINDS:
            if not (have_dxf_codes[k] or have_pdf[k] or have_dxf_plan[k]):
                continue
            d_i = [i for i in inst if i["room"] == no and i["kind"] == k and i["src"] == "DXF"]
            p_i = [i for i in inst if i["room"] == no and i["kind"] == k and i["src"] == "PDF"]
            ds, ps = sorted({i["code"] for i in d_i}), sorted({i["code"] for i in p_i})
            srcs_k = [{"src": i["src"], "file": i["file"]["name"], "value": i["code"], "how": i["how"], "confidence": i["conf"]} for i in d_i + p_i]
            confs = [i["conf"] for i in d_i + p_i]
            note = None
            if not ds and not ps:
                st, codes = "missing", []
            elif have_dxf_codes[k] and have_pdf[k] and ds and ps:
                if ds == ps:
                    st = "certain" if all(c == "certain" for c in confs) else "estimated"
                    codes = ps
                else:
                    st, codes = "conflict", ps
                    changed = sorted({f"{i['code']}→{i['pdf_same_spot']}" for i in d_i if i.get("pdf_same_spot") and i["pdf_same_spot"] != i["code"]})
                    note = "DXF: " + ", ".join(ds) + " · PDF: " + ", ".join(ps) + (f" · אותה תווית, טקסט שונה: {', '.join(changed)}" if changed else "")
            elif have_dxf_codes[k] and have_pdf[k]:
                st, codes = "single", ds or ps
                note = ("רק ב-DXF" if ds else "רק ב-PDF")
            else:
                st = "certain" if all(c == "certain" for c in confs) else "estimated"
                codes = ds or ps
                if not have_dxf_codes[k] and have_dxf_plan[k]:
                    note = "ב-DXF של התוכנית אין טקסט; הקודים נקראו מה-PDF"
            if k == "FN" and st == "certain" and any(c == "estimated" for c in confs):
                st = "estimated"
            item(no, k, {"codes": codes, "alternatives": {"DXF": ds, "PDF": ps}}, st, srcs_k, note)

    # rooms approved before and missing from this set
    for no, cur in current.items():
        if cur.get("status") == "active" and no not in all_numbers:
            items.append({"room_no": no, "field": "room", "proposed": {"value": None}, "current": {"value": no},
                          "change_type": "removed", "status": "missing", "rvt_verified": False, "sources": [],
                          "note": "אושר בעבר, ולא נמצא באף קובץ בגרסה הזו", "decision": "pending"})

    floor_map = _map(base, F, rvt_rooms)
    summary = {"rooms": len(all_numbers), "items": len(items), "status": dict(Counter(i["status"] for i in items)),
               "changes": dict(Counter(i["change_type"] for i in items)), "placed_pdfs": len(placed), "rvt_rooms": len(rvt_rooms),
               "boundaries": dict(Counter(r["grade"] for r in F.rooms.values()))}
    return {"items": items, "sources": sources, "views": views, "map": floor_map, "warnings": warnings, "summary": summary}


def _room_key(n):
    m = re.match(r"(\d+)(.*)", n)
    return (int(m.group(1)), m.group(2)) if m else (10 ** 9, n)


def _current_value(cur, field):
    if cur is None:
        return None
    if field == "room":
        return {"value": cur["room_no"]} if cur.get("status") == "active" else None
    if field == "name":
        return {"value": cur.get("name")}
    if field == "area":
        return {"value": float(cur["area"]) if cur.get("area") is not None else None}
    if field == "boundary":
        return {"poly": cur.get("boundary"), "x": cur.get("x"), "y": cur.get("y")}
    return {"codes": sorted(cur.get("finishes", {}).get(field, []))}


def _same(field, cur, prop):
    if cur is None:
        return False
    if field in ("FL", "FN", "CL"):
        return sorted(cur.get("codes") or []) == sorted(prop.get("codes") or [])
    if field == "boundary":
        a, b = cur.get("poly"), prop.get("poly")
        if not a or not b:
            return a == b
        pa, pb = Polygon(a), Polygon(b)
        return pa.symmetric_difference(pb).area < 0.02 * max(pa.area, 1)
    if field == "area":
        return cur.get("value") is not None and prop.get("value") is not None and abs(float(cur["value"]) - float(prop["value"])) < 0.05
    return _norm(str(cur.get("value"))) == _norm(str(prop.get("value")))


def _map(base, F, rvt_rooms):
    """Phone map: walls outline + one shape or dot per room, in a local frame (cm, y down)."""
    walls = base["data"].get("walls") or []
    pts = [p for poly in walls for ring in poly for p in ring] + [p for r in F.rooms.values() if r["poly"] is not None for p in r["poly"].exterior.coords]
    if not pts:
        return None
    minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
    miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
    pad = 60
    tx = lambda x: round(x - minx + pad)
    ty = lambda y: round(maxy - y + pad)

    def path(rings):
        return "".join("M" + " ".join(f"{tx(x)} {ty(y)}" for x, y in ring[:-1]) + "Z" for ring in rings)

    rooms = []
    for no, r in F.rooms.items():
        if r["poly"] is not None:
            c = r["poly"].representative_point()
            rooms.append({"n": no, "d": path([list(r["poly"].exterior.coords)]), "x": tx(c.x), "y": ty(c.y)})
        else:
            rv = rvt_rooms.get(no)
            x, y = (rv["x"], rv["y"]) if rv else r["tag"]["anchor"]
            rooms.append({"n": no, "d": None, "x": tx(x), "y": ty(y)})
    return {"w": round(maxx - minx + 2 * pad), "h": round(maxy - miny + 2 * pad), "walls": "".join(path(poly) for poly in walls),
            "rooms": rooms, "origin": [minx - pad, maxy + pad]}
