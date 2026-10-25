"""Per-file step: read one uploaded file and keep only what the cross-check needs (a small JSON).

DXF -> room tags, rebuilt boundaries, finish-code tags, leader lines, wall outline for the phone map
PDF -> room numbers and finish codes with positions on the main sheet, revision/date hints
RVT -> rooms (number, name, location), finish type marks, file information
"""
import time

from shapely.geometry import LineString
from shapely.ops import unary_union

from . import dxf_reader, pdf_reader, rooms, rvt_reader
from .dxf_reader import WALL_LAYERS

MAP_LAYERS = WALL_LAYERS | {"S-STRS"}


def walls_outline(d):
    """One simplified outline of the walls and glazing, for the phone map (a few tens of KB)."""
    lines = [LineString([(s[0], s[1]), (s[2], s[3])]) for L, segs in d["segments"].items() if L in MAP_LAYERS
             for s in segs if (s[0], s[1]) != (s[2], s[3]) and L not in ("A-DOOR", "A-DOOR-OPNG")]
    if not lines:
        return None
    g = unary_union([l.buffer(3, cap_style=2) for l in lines]).simplify(4)
    polys = g.geoms if hasattr(g, "geoms") else [g]
    return [[[[round(x, 1), round(y, 1)] for x, y in ring.coords] for ring in [p.exterior, *p.interiors]] for p in polys]


def extract(path, fmt):
    t0 = time.time()
    if fmt == "dxf":
        d = dxf_reader.read(path)
        tags, loose = dxf_reader.room_tags(d)
        codes = dxf_reader.code_tags(d)
        hint, kinds = dxf_reader.content_hint(d)
        bounds = rooms.rebuild(d, tags) if tags else {}
        out = {"kind": "dxf", "tags": tags, "loose_names": [{"t": f["t"], "x": f["x"], "y": f["y"]} for f in loose],
               "codes": codes, "leaders": dxf_reader.leader_lines(d), "boundaries": bounds,
               "walls": walls_outline(d) if tags else None,
               "content_hint": hint, "code_kinds": kinds, "integrity": d["integrity"], "warnings": d["warnings"]}
        if not tags:
            out["warnings"].append("אין תוויות חדרים ב-DXF הזה")
    elif fmt == "pdf":
        d = pdf_reader.read(path)
        hint, kinds = pdf_reader.content_hint(d)
        out = {"kind": "pdf", "page": pdf_reader.main_page(d), "content_hint": hint, "code_kinds": kinds,
               "integrity": d["integrity"], "warnings": d["warnings"]}
    elif fmt == "rvt":
        d = rvt_reader.read(path)
        out = {"kind": "rvt", "rooms": d["rooms"], "finish_codes": d["finish_codes"], "info": d["info"],
               "content_hint": "MODEL", "integrity": d["integrity"], "warnings": d["warnings"]}
    else:
        raise ValueError(f"unsupported format {fmt}")
    out["integrity"]["extract_sec"] = round(time.time() - t0)
    return out
