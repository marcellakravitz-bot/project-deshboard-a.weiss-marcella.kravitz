"""Rebuild room boundaries from wall linework and check each one against the area printed in its tag.

Walls are separate lines with gaps at doors. The linework is thickened and morphologically closed
(grow by R, shrink by R): gaps narrower than 2R close, rooms survive. Several R are tried per room and the
boundary is kept only when its area agrees with the tag. A boundary that does not agree is never used as if
it were right: it is graded "near" (shown as estimated) or dropped.
"""
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .dxf_reader import WALL_LAYERS, BOUNDARY_EXTRA_LAYERS

RADII = (10, 30, 50, 70, 90, 120)


def grade(tag_area, geom_area):
    if geom_area is None or tag_area is None:
        return "none"
    d = abs(geom_area - tag_area)
    if d <= max(1.0, 0.07 * tag_area):     # Revit prints whole m2
        return "match"
    if d <= 0.25 * tag_area:
        return "near"
    return "wrong"


def _faces(lines, R):
    walls = unary_union([g.buffer(2.0, cap_style=2) for g in lines])
    closed = walls.buffer(R, join_style=2).buffer(-R, join_style=2)
    polys = closed.geoms if hasattr(closed, "geoms") else [closed]
    return [Polygon(ring) for p in polys for ring in p.interiors]


def boundary_lines(d, with_links=True):
    lines = []
    for L, segs in d["segments"].items():
        if L in WALL_LAYERS or (with_links and L in BOUNDARY_EXTRA_LAYERS):
            lines += [LineString([(s[0], s[1]), (s[2], s[3])]) for s in segs if (s[0], s[1]) != (s[2], s[3])]
    for ring in d["wall_fill"]:
        if len(ring) >= 2:
            lines.append(LineString(list(ring) + [ring[0]]))
    return lines


def rebuild(d, tags, radii=RADII):
    """Linework is tried with and without the linked models: the facade often lives only in a linked model,
    but a linked model can also cut a room the plan itself closes correctly. The tag area decides."""
    variants = {}
    for with_links in (True, False):
        lines = boundary_lines(d, with_links)
        if lines and (with_links or any(L in BOUNDARY_EXTRA_LAYERS for L in d["segments"])):
            variants[with_links] = lines
    if not variants:
        return {t["room"]: _none(t) for t in tags}
    keys = [(v, R) for v in variants for R in radii]
    sets = {(v, R): _faces(variants[v], R) for v, R in keys}
    trees = {k: STRtree(f) for k, f in sets.items()}
    out = {}
    for t in tags:
        cands = []
        for R in keys:
            for via, p in (("anchor", t["anchor"]), ("number", t["number_pos"])):
                pt = Point(p)
                hit = [sets[R][i] for i in trees[R].query(pt) if sets[R][i].contains(pt)]
                if hit:
                    f = min(hit, key=lambda q: q.area)
                    ga = round(f.area / 1e4, 2)
                    cands.append({"poly": f, "geom_area": ga, "R": R[1], "links": R[0], "via": via, "grade": grade(t["area"], ga)})
        m = [c for c in cands if c["grade"] == "match"]
        if m:
            best = min(m, key=lambda c: (abs(c["geom_area"] - t["area"]) > 1.0, c["R"], not c["links"], c["via"] != "anchor"))
        elif cands and t["area"] is not None:
            best = min(cands, key=lambda c: abs(c["geom_area"] - t["area"]))
        else:
            best = None
        if best is None or best["grade"] in ("wrong", "none"):
            out[t["room"]] = _none(t, best)
        else:
            poly = best["poly"].simplify(1.0)
            out[t["room"]] = {"grade": best["grade"], "geom_area": best["geom_area"], "R": best["R"], "links": best["links"],
                              "poly": [[round(x, 1), round(y, 1)] for x, y in poly.exterior.coords]}
    return out


def _none(t, best=None):
    return {"grade": "none", "geom_area": best["geom_area"] if best else None, "R": None, "poly": None,
            "rejected_area": best["geom_area"] if best else None}
