"""Read rooms out of a Revit .rvt file without Revit — validation source only.

An .rvt is an OLE compound file; element data sits in gzip-compressed "Partitions/*" streams.
What is read (checked on Cisco Caesarea, 12413-CAE02-STR-IN-R25.rvt, Revit 2025):
  * file information (BasicFileInfo): Revit version, central model path, number of saves
  * every room record: number (parameter -1006901) and name (-1006900) as UTF-16 strings, and the room's
    location point, two doubles in feet that sit 374 bytes before the number
  * finish type marks (FL-/FN-/CL- strings) present anywhere in the model
What is NOT read: room area, room boundary, level, finish assigned to a room — those need Revit itself.

This is decoding of the file layout, not an Autodesk interface. The caller treats the result as a
validation hint: if it stops matching the DXF (a different Revit version, say) the result is set aside.
The file keeps older copies of elements; for each room the copy in the latest partition is taken.
"""
import re
import struct
import zlib
from collections import defaultdict

import olefile

P_NUMBER, P_NAME = -1006901, -1006900
LOC_OFFSET = 374
FT_TO_CM = 30.48
CODE_RE = re.compile(r"^(FL|FN|CL)-?\d+[A-Za-z]?")
LEN_RE = re.compile(rb"[\x01-\xc8]\x00\x00\x00")
CHUNK = 64 * 1024 * 1024
OVERLAP = 8192


def _strings(buf, base, start_min):
    """[int64 param id][uint32 n][n UTF-16 chars] records in buf (positions >= start_min)."""
    out = []
    L = len(buf)
    for m in LEN_RE.finditer(buf):
        p = m.start()
        if p < max(8, start_min):
            continue
        n = buf[p]
        s1 = p + 4 + 2 * n
        if s1 > L:
            continue
        try:
            s = buf[p + 4:s1].decode("utf-16-le")
        except UnicodeDecodeError:
            continue
        if not s.isprintable() or not any(c.isalnum() for c in s):
            continue
        out.append((base + p, struct.unpack_from("<q", buf, p - 8)[0], s, p))
    return out


def _members(data):
    """Yield the decompressed gzip members of one stream, reading in chunks (no huge copies)."""
    mv = memoryview(data)
    L = len(data)
    i = 0
    while True:
        j = data.find(b"\x1f\x8b\x08", i)
        if j < 0:
            return
        z = zlib.decompressobj(31)
        p = j
        parts = []
        try:
            while not z.eof and p < L:
                parts.append(z.decompress(mv[p:p + 1048576]))
                p += 1048576
        except zlib.error:
            i = j + 3
            continue
        if z.eof:
            i = p - len(z.unused_data)
            yield b"".join(parts)
        else:
            i = j + 3


def read(path, floor_hint=None):
    ole = olefile.OleFileIO(path)
    warnings = []
    info = {}
    try:
        txt = ole.openstream("BasicFileInfo").read().decode("utf-16-le", "ignore")
        for key, rx in (("format", r"Format:\s*(\d{4})"), ("central_path", r"Central Model Path:\s*([^\r\n\x00]+)"),
                        ("saves", r"version number corresponding to the last reload latest:\s*(\d+)")):
            m = re.search(rx, txt)
            if m:
                info[key] = m.group(1).strip()
    except Exception:
        warnings.append("לא ניתן לקרוא את פרטי הקובץ (BasicFileInfo)")

    rooms = defaultdict(list)     # number -> [(partition, name, x_cm, y_cm)]
    codes = set()
    streams = [e for e in ole.listdir() if e[0] == "Partitions"]
    for e in streams:
        try:
            part = int(e[1])
        except ValueError:
            part = -1
        data = ole.openstream("/".join(e)).read()
        parts, size = [], 0
        start = 0                      # records before this offset were handled by the previous chunk
        for member in _members(data):
            parts.append(member)
            size += len(member)
            if size < CHUNK:
                continue
            buf = b"".join(parts)
            _scan(buf, part, rooms, codes, start, len(buf) - OVERLAP + 1024)
            parts, size, start = [buf[-OVERLAP:]], OVERLAP, 1024
        if parts:
            buf = b"".join(parts)
            _scan(buf, part, rooms, codes, start, len(buf))
        del data

    out = []
    for no, copies in rooms.items():
        copies.sort(key=lambda c: c[0])
        part, name, x, y = copies[-1]
        moved = max(c[2] for c in copies) - min(c[2] for c in copies) > 5 or max(c[3] for c in copies) - min(c[3] for c in copies) > 5
        out.append({"room": no, "name": name, "x": round(x, 1), "y": round(y, 1), "copies": len(copies),
                    "latest_partition": part, "moved_between_copies": moved})
    if not out:
        warnings.append("לא נמצאו חדרים — ייתכן שאין חדרים במודל, או שמבנה הקובץ אינו מוכר לקורא הזה")
    return {"info": info, "rooms": out, "finish_codes": sorted(codes),
            "integrity": {"partitions": len(streams), "room_numbers": len(out), "finish_codes": len(codes)}, "warnings": warnings}


def _scan(buf, part, rooms, codes, start, limit):
    recs = _strings(buf, 0, 0)
    for i, (_, pid, s, p) in enumerate(recs):
        if p < start:
            continue
        if p >= limit:
            break
        if CODE_RE.match(s) and not re.search(r"\.(jpg|png)", s, re.I):
            codes.add(s)
        if pid == P_NUMBER and p >= LOC_OFFSET:
            name = recs[i + 1][2] if i + 1 < len(recs) and recs[i + 1][1] == P_NAME and recs[i + 1][3] - (p + 4 + 2 * len(s)) < 64 else None
            x, y = struct.unpack_from("<2d", buf, p - LOC_OFFSET)
            if abs(x) < 1e5 and abs(y) < 1e5:
                rooms[s].append((part, name, x * FT_TO_CM, y * FT_TO_CM))
