"""Read one PDF plan sheet: room numbers and finish codes with their positions, and revision hints.

Words come from poppler's pdftotext -bbox (1-2 s for a dense A0 sheet; the same words the floor-4 checks used).
Positions are PDF points with y measured from the top of the page.
A scanned sheet has no text layer; that is reported, not guessed around.
"""
import html
import re
import subprocess

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


def read(path):
    warnings = []
    pages = []
    for i, (pw, ph, words) in enumerate(_pages(path)):
        nums = [{"room": w["text"].strip(), "x": (w["x0"] + w["x1"]) / 2, "y": (w["top"] + w["bottom"]) / 2}
                for w in words if ROOM_NO.match(w["text"].strip())]
        codes = _codes(words)
        dates = [m.group(0) for w in words for m in [DATE_RE.search(w["text"])] if m]
        rev = []
        for j, w in enumerate(words):
            if REV_RE.match(w["text"].strip()) and j + 1 < len(words):
                nxt = words[j + 1]["text"].strip()
                if any(c.isalnum() for c in nxt):
                    rev.append(nxt)
        pages.append({"page": i + 1, "width": pw, "height": ph, "n_words": len(words),
                      "numbers": nums, "codes": codes, "dates": dates[:40], "revisions": rev[:10]})
    if not pages:
        warnings.append("אין עמודים בקובץ ה-PDF")
    elif all(p["n_words"] == 0 for p in pages):
        warnings.append("אין שכבת טקסט (גיליון סרוק?) — אי אפשר לקרוא מה-PDF הזה")
    main = max(pages, key=lambda p: len(p["numbers"]) + len(p["codes"])) if pages else None
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
