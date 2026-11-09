"""Variant choices from the room list are applied to the next cross-check (build 9 / worker 6)."""
from byroom_worker.crosscheck import apply_choices, canon


def item(room, field, codes, change="changed"):
    return {"room_no": room, "field": field, "proposed": {"codes": codes}, "change_type": change, "decision": "pending", "note": None}


def test_choice_replaces_code_and_matches_approved():
    res = {"items": [item("701", "CL", ["C-2"]), item("702", "CL", ["C-2"]), item("701", "name", None)]}
    res["items"][2]["proposed"] = {"value": "x"}
    current = {"701": {"room_no": "701", "status": "active", "finishes": {"CL": ["C-2A"]}}}
    n = apply_choices(res, {("701", "CL", canon("C-2")): "C-2A"}, current)
    a, b = res["items"][0], res["items"][1]
    assert n == 1
    assert a["proposed"]["codes"] == ["C-2A"] and a["change_type"] == "same" and a["decision"] == "unchanged"
    assert "C-2A במקום C-2" in a["note"]
    assert b["proposed"]["codes"] == ["C-2"]                     # another room keeps its own reading


def test_no_choices_no_change():
    res = {"items": [item("701", "CL", ["C-2"])]}
    assert apply_choices(res, {}, {}) == 0 and res["items"][0]["proposed"]["codes"] == ["C-2"]
