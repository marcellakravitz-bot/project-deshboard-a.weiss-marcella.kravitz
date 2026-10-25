"""Regression check on the real Cisco Caesarea floor 4 files (not in the repo — too large; run locally).

    python -m byroom_worker.main local --out /tmp/l4  FL:dxf:<FL.dxf> FN:dxf:<FN.dxf> CL:dxf:<CL.dxf> \
        FL:pdf:<FL.pdf> FN:pdf:<FN.pdf> CL:pdf:<CL.pdf> MODEL:rvt:<model.rvt>
    L4_RESULT=/tmp/l4/result.json python -m pytest tests/test_floor4.py

The numbers are what was measured by hand on these files (By_Room_accuracy_L4.xlsx, RVT_vs_DXF_PDF_L4.xlsx).
"""
import json
import os
from collections import Counter

import pytest

R = os.environ.get("L4_RESULT")
pytestmark = pytest.mark.skipif(not R, reason="set L4_RESULT to a local result.json")


@pytest.fixture(scope="module")
def res():
    return json.load(open(R))


def by(res, field):
    return {i["room_no"]: i for i in res["items"] if i["field"] == field}


def test_all_43_rooms(res):
    rooms = by(res, "room")
    dxf_rooms = [n for n, i in rooms.items() if any(s["src"] == "DXF" for s in i["sources"])]
    assert len(dxf_rooms) == 43


def test_boundaries_at_least_as_good_as_by_hand(res):
    b = Counter(i["status"] for i in by(res, "boundary").values())
    assert b["certain"] + b["estimated"] >= 36          # by hand: 36 of 43; the worker closes more with the linked model


def test_rvt_confirms_names(res):
    names = by(res, "name")
    assert sum(1 for i in names.values() if i["rvt_verified"]) >= 40


def test_elevation_markers_are_not_rooms(res):
    assert not any("." in n for n in by(res, "room"))


def test_split_codes_joined(res):
    codes = {c for i in res["items"] if i["field"] in ("FL", "FN", "CL") for c in (i["proposed"].get("codes") or [])}
    assert not any(c.endswith("-") for c in codes)


def test_rvt_only_rooms_flagged_single(res):
    rooms = by(res, "room")
    for n in ("404a", "422a", "447"):
        if n in rooms:
            assert rooms[n]["status"] == "single"
