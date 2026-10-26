"""Read one PDF plan sheet: room numbers and finish codes with their positions, and revision hints.

Words come from poppler's pdftotext -bbox (1-2 s for a dense A0 sheet; the same words the floor-4 checks used).
Positions are PDF points with y measured from the top of the page.
A scanned sheet has no text layer; that is reported, not guessed around.
"""
import base64
import html
import os
import re
import subprocess
import tempfile

PAGE_RE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', re.S)
WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')


def _pages(path):
    out = subprocess.run(["pdftotext", "-bbox", path, "-"], capture_output=True, text=True, timeout=600)
    if out.returncode != 0:
        raise RuntimeError("PDF could not be read: " + out.stderr[:300])
    for w, h, body in PAGE_RE.findall(out.stdout):
        words = [{"text": html.unescape(t), "x0": float(a), "top": float(b), "x1": float(c), "bottom": float(d)}
                 for a, b, c, d, t in WORD_RE.findall(body)]
        yield float(w), float(h), words

ROOM_NO = re.compile(r"^\d{3}[A-Za-z]?$")
CODE_RE = re.compile(r"^(FL|FN|CL)-?\d+[A-Za-z]?$", re.I)
MARK_RE = re.compile(r"^[A-Za-z]{1,4}[-.]?\d{1,3}[A-Za-z]?$")
LETTER = re.compile(r"^[A-Za-z]$")
DATE_RE = re.compile(r"\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b")
REV_RE = re.compile(r"^(REV|REVISION|גרסה|מהדורה)\.?:?$", re.I)


def _codes(words):
    """Finish codes as printed. A suffix letter drawn as a separate overlapping text ("CL-4" + "A") is joined
    and flagged so the reviewer sees it was joined."""
    out = []
    for w in words:
        s = w["text"].strip()
        if not CODE_RE.match(s):
            continue
        h = w["bottom"] - w["top"]
        flag = None
        suf = [v for v in words if LETTER.match(v["text"]) and abs(v["top"] - w["top"]) < h * 0.5
               and w["x0"] + 0.5 * (w["x1"] - w["x0"]) < v["x0"] < w["x1"] + 3]
        if suf:
            letter = suf[0]["text"]
            if re.search(r"\d$", s):
                s, flag = s + letter, f"האות {letter} מודפסת כטקסט נפרד וחוברה"
            else:
                s, flag = f"{s}+{letter}", f"תווית {s} ועליה האות {letter}"
        out.append({"code": s, "kind": s[:2].upper(), "x": (w["x0"] + w["x1"]) / 2, "y": (w["top"] + w["bottom"]) / 2, "flag": flag})
    return out


AREA_UNIT = re.compile(r"^(m²|m2|מ\"ר|מ״ר|sqm|SQM)$")
NUM = re.compile(r"^\d+([.,]\d+)?$")


HEB = re.compile(r"[\u0590-\u05FF]")
LATIN = re.compile(r"[A-Za-z]")


def _txt(w):
    """pdftotext gives Hebrew in drawing order (reversed): every run of Hebrew letters is turned back."""
    return re.sub(r"[\u0590-\u05FF][\u0590-\u05FF\"'״׳]*", lambda m: m.group(0)[::-1], w["text"].strip())


def _line_text(ws):
    ws = sorted(ws, key=lambda w: w["x0"])
    if sum(bool(HEB.search(w["text"])) for w in ws) > len(ws) / 2:
        ws = ws[::-1]                                       # a Hebrew line reads right to left
    return " ".join(_txt(w) for w in ws)


def _tags(words):
    """Room tags as architects draw them: a room number standing alone on its line, its name on the lines just under
    it, and the area ("12 m²") under the name. Nothing is assumed about fonts, layers or blocks."""
    out = []
    cx = lambda w: (w["x0"] + w["x1"]) / 2
    cy = lambda w: (w["top"] + w["bottom"]) / 2
    for n in words:
        t = n["text"].strip()
        if not ROOM_NO.match(t):
            continue
        h = max(4.0, n["bottom"] - n["top"])
        x, y = cx(n), cy(n)
        # a number that is part of a phrase ("Center 119 P.", "1:50") is not a room tag
        if any(w is not n and abs(cy(w) - y) < 0.5 * h and (0 <= n["x0"] - w["x1"] < 1.2 * h or 0 <= w["x0"] - n["x1"] < 1.2 * h) for w in words):
            continue
        below = [w for w in words if w is not n and 0.4 * h < cy(w) - y < 7 * h and abs(cx(w) - x) < 14 * h]
        lines = []
        for w in sorted(below, key=lambda w: cy(w)):
            if lines and abs(cy(w) - lines[-1][0]) < 0.6 * h:
                lines[-1][1].append(w)
            else:
                lines.append([cy(w), [w]])
        area, name, last = None, [], y
        for ly, ws in lines:
            if ly - last > 2.2 * h:                         # a gap: the tag has ended
                break
            # keep the phrase under the tag's centre (a neighbour's text on the same line is left out)
            ws = [w for w in ws if not CODE_RE.match(w["text"].strip()) and not MARK_RE.match(w["text"].strip()) and w["text"].strip() not in ("mr", "cm")]
            if not ws:
                continue
            core = min(ws, key=lambda w: abs(cx(w) - x))
            if abs(cx(core) - x) > 5 * h:
                break
            run, grown = [core], True
            while grown:
                grown = False
                for w in ws:
                    if w not in run and any(-0.2 * h < w["x0"] - r["x1"] < 0.9 * h or -0.2 * h < r["x0"] - w["x1"] < 0.9 * h for r in run):
                        run.append(w); grown = True
            if all(NUM.match(w["text"].strip()) for w in run) and not any(AREA_UNIT.match(w["text"].strip()) for w in ws):
                continue                                    # a dimension line, not part of the tag
            units = [w for w in ws if AREA_UNIT.match(w["text"].strip()) and abs(cx(w) - x) < 5 * h]
            if units:
                u = min(units, key=lambda w: abs(cx(w) - x))
                nums = [v for v in ws if NUM.match(v["text"].strip()) and 0 <= u["x0"] - v["x1"] < 1.5 * h]
                if nums:
                    area = float(sorted(nums, key=lambda v: v["x0"])[-1]["text"].replace(",", "."))
                break
            name.append(_line_text(run))
            last = ly
            if len(name) >= 3:
                break
        nm = re.sub(r"(\s+\d+[.,]\d+)+$", "", " ".join(name).strip())      # a dimension caught at the end of the name
        out.append({"room": t, "x": x, "y": y, "h": h, "area": area, "name": nm})
    return out


def _preview(path, page, bbox, pw, ph, max_px=1500):
    """A light grey picture of the plan part of the sheet, for the phone map when there is no DXF to draw it from."""
    x0, y0, x1, y1 = bbox
    dpi = max(18, min(110, max_px / max(1.0, (x1 - x0)) * 72))
    sc = dpi / 72
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "p")
        r = subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-r", f"{dpi:.2f}", "-gray", "-jpeg", "-jpegopt", "quality=45",
                            "-x", str(int(x0 * sc)), "-y", str(int(y0 * sc)), "-W", str(int((x1 - x0) * sc)), "-H", str(int((y1 - y0) * sc)),
                            "-singlefile", path, out], capture_output=True, timeout=300)
        if r.returncode != 0 or not os.path.exists(out + ".jpg"):
            return None
        data = open(out + ".jpg", "rb").read()
    return {"img": "data:image/jpeg;base64," + base64.b64encode(data).decode(), "bbox": [x0, y0, x1, y1], "bytes": len(data)}


def plan_box(tags, pw, ph, floor_digit=None):
    """Where the plan is on the sheet: around the room tags of this floor (the legend and the title block are left out)."""
    pts = [t for t in tags if t["area"] is not None] or tags
    if floor_digit:
        pts = [t for t in pts if t["room"].startswith(floor_digit)] or pts
    if len(pts) < 3:
        return None
    import math
    nn = sorted(min(math.hypot(a["x"] - b["x"], a["y"] - b["y"]) for b in pts if b is not a) for a in pts)
    m = max(80.0, 1.6 * nn[len(nn) // 2])                # about one room beyond the outermost tags
    x0, x1 = min(t["x"] for t in pts) - m, max(t["x"] for t in pts) + m
    y0, y1 = min(t["y"] for t in pts) - m, max(t["y"] for t in pts) + m
    return [max(0, x0), max(0, y0), min(pw, x1), min(ph, y1)]


def read(path):
    warnings = []
    pages = []
    for i, (pw, ph, words) in enumerate(_pages(path)):
        nums = [{"room": w["text"].strip(), "x": (w["x0"] + w["x1"]) / 2, "y": (w["top"] + w["bottom"]) / 2}
                for w in words if ROOM_NO.match(w["text"].strip())]
        codes = _codes(words)
        # every other code-like word; the cross-check keeps only the project's defined marks
        marks = [{"code": w["text"].strip(), "x": (w["x0"] + w["x1"]) / 2, "y": (w["top"] + w["bottom"]) / 2}
                 for w in words if MARK_RE.match(w["text"].strip()) and not CODE_RE.match(w["text"].strip())][:20000]
        dates = [m.group(0) for w in words for m in [DATE_RE.search(w["text"])] if m]
        rev = []
        for j, w in enumerate(words):
            if REV_RE.match(w["text"].strip()) and j + 1 < len(words):
                nxt = words[j + 1]["text"].strip()
                if any(c.isalnum() for c in nxt):
                    rev.append(nxt)
        pages.append({"page": i + 1, "width": pw, "height": ph, "n_words": len(words),
                      "numbers": nums, "codes": codes, "marks": marks, "tags": _tags(words), "dates": dates[:40], "revisions": rev[:10]})
    if not pages:
        warnings.append("אין עמודים בקובץ ה-PDF")
    elif all(p["n_words"] == 0 for p in pages):
        warnings.append("אין שכבת טקסט (גיליון סרוק?) — אי אפשר לקרוא מה-PDF הזה")
    main = max(pages, key=lambda p: len(p["numbers"]) + len(p["codes"])) if pages else None
    if main:
        tagged = [t for t in main["tags"] if t["area"] is not None]
        lead = max(set(t["room"][0] for t in tagged), key=lambda c: sum(t["room"][0] == c for t in tagged)) if tagged else None
        box = plan_box(main["tags"], main["width"], main["height"], lead)
        if box:
            main["plan_box"] = box
            try:
                main["preview"] = _preview(path, main["page"], box, main["width"], main["height"])
            except Exception as ex:                      # the picture is a convenience; reading goes on without it
                warnings.append(f"לא נוצרה תמונת תוכנית: {ex}")
    integrity = {"pages": len(pages), "words": sum(p["n_words"] for p in pages),
                 "numbers": len(main["numbers"]) if main else 0, "codes": len(main["codes"]) if main else 0}
    return {"pages": pages, "main_page": main["page"] if main else None, "integrity": integrity, "warnings": warnings}


def main_page(d):
    return next((p for p in d["pages"] if p["page"] == d["main_page"]), None)


def content_hint(d):
    p = main_page(d)
    if not p:
        return None, {}
    from collections import Counter
    kinds = Counter(c["kind"] for c in p["codes"])
    return (kinds.most_common(1)[0][0] if kinds else None), dict(kinds)
