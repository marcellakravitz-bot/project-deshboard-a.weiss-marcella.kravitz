"""Place a PDF sheet on the DXF: find the transform DXF (cm, y up) -> PDF page (points, y down).

1. Room numbers that appear exactly once in both files give an affine fit (outliers dropped).
2. A sheet whose numbers sit elsewhere than in the DXF tags (the ceiling sheet) is placed by a search:
   scale from another sheet of the same set, or a standard drawing scale, and the translation that puts the
   most PDF room numbers inside their own rebuilt rooms. The result carries its own error estimate.
"""
from collections import Counter

import numpy as np
import shapely

PT_PER_CM = 72 / 2.54


def apply(M, x, y):
    M = np.asarray(M)
    return float(x * M[0][0] + y * M[1][0] + M[2][0]), float(x * M[0][1] + y * M[1][1] + M[2][1])


def invert(M):
    M = np.asarray(M, dtype=float)
    A, t = M[:2, :2], M[2]
    Ai = np.linalg.inv(A)
    return lambda px, py: tuple(float(v) for v in (np.array([px, py]) - t) @ Ai)


def _fit(src, dst):
    A = np.array([[x, y, 1] for x, y in src])
    M, *_ = np.linalg.lstsq(A, np.array(dst), rcond=None)
    return M


def by_numbers(dxf_pts, pdf_numbers, tol=6.0):
    cnt = Counter(n["room"] for n in pdf_numbers)
    pdf_pts = {n["room"]: (n["x"], n["y"]) for n in pdf_numbers if cnt[n["room"]] == 1}
    keys = sorted(set(dxf_pts) & set(pdf_pts))
    if len(keys) < 4:
        return None
    use = list(keys)
    for _ in range(3):
        M = _fit([dxf_pts[k] for k in use], [pdf_pts[k] for k in use])
        err = {k: float(np.hypot(*(np.array([*dxf_pts[k], 1]) @ M - np.array(pdf_pts[k])))) for k in keys}
        use = [k for k in keys if err[k] < max(tol, float(np.median(list(err.values()))) * 3)]
        if len(use) < 4:
            return None
    M = _fit([dxf_pts[k] for k in use], [pdf_pts[k] for k in use])
    sx = float(np.sqrt(abs(np.linalg.det(M[:2, :2]))))
    fit_err = max(float(np.hypot(*(np.array([*dxf_pts[k], 1]) @ M - np.array(pdf_pts[k])))) for k in use)
    # a 1:50 sheet is ~0.567 pt/cm; anything far from a drawing scale is a wrong match, not a fit
    if not (0.02 < sx < 5):
        return None
    return {"M": M.tolist(), "method": "room numbers", "shared": len(keys), "used": len(use),
            "fit_error_pt": round(fit_err, 2), "fit_error_cm": round(fit_err / sx, 1), "scale": sx}


def by_rooms(polys, pdf_numbers, page_w, page_h, scales):
    """polys: {room: Polygon in DXF cm}. Translation search per candidate scale (y flipped)."""
    pts = {}
    for n in pdf_numbers:
        if n["room"] in polys and n["room"] not in pts:
            pts[n["room"]] = (n["x"], n["y"])
    if len(pts) < 4:
        return None
    names = list(pts)
    P = np.array([pts[k] for k in names])
    geoms = [polys[k] for k in names]
    for g in geoms:
        shapely.prepare(g)
    minx, miny, maxx, maxy = shapely.union_all(list(polys.values())).bounds
    best = None
    def scores(s, TX, TY):
        tot = np.zeros(TX.shape, dtype=int)
        for (px, py), g in zip(P, geoms):
            tot += shapely.contains_xy(g, (px - TX) / s, (TY - py) / s)
        return tot

    for s in scales:
        tx_lo, tx_hi = -s * minx, page_w - s * maxx
        ty_lo, ty_hi = s * maxy, page_h + s * miny
        if tx_hi < tx_lo or ty_hi < ty_lo:
            continue
        TX, TY = np.meshgrid(np.arange(tx_lo, tx_hi + 1, 12), np.arange(ty_lo, ty_hi + 1, 12))
        TX, TY = TX.ravel(), TY.ravel()
        sc = scores(s, TX, TY)
        m = int(sc.max())
        for i in np.flatnonzero(sc == m)[:30]:
            fx, fy = np.meshgrid(np.arange(TX[i] - 18, TX[i] + 18, 1.5), np.arange(TY[i] - 18, TY[i] + 18, 1.5))
            fx, fy = fx.ravel(), fy.ravel()
            fs = scores(s, fx, fy)
            fm = int(fs.max())
            sel = fs == fm
            tx, ty = float(fx[sel].mean()), float(fy[sel].mean())
            spread = float(max(np.ptp(fx[sel]), np.ptp(fy[sel]))) / 2
            if best is None or fm > best[0] or (fm == best[0] and spread < best[4]):
                best = (fm, s, tx, ty, spread)
    if best is None or best[0] < max(4, 0.6 * len(pts)):
        return None
    fm, s, tx, ty, spread = best
    return {"M": [[s, 0], [0, -s], [tx, ty]], "method": "room positions (search)", "shared": len(pts), "used": fm,
            "fit_error_pt": round(spread, 2), "fit_error_cm": round(spread / s, 1), "scale": s}


STANDARD_SCALES = [PT_PER_CM / n for n in (50, 100, 75, 200, 25, 20)]
