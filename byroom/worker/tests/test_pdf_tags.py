"""Room tags read from a PDF sheet: stacked tags, and the two-box tag (number and name side by side) — build 5.

    python -m pytest tests/test_pdf_tags.py        (needs reportlab and poppler's pdftotext)
"""
import os
import tempfile

import pytest

rl = pytest.importorskip("reportlab")
from reportlab.pdfbase import pdfmetrics            # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont         # noqa: E402
from reportlab.pdfgen import canvas                   # noqa: E402

from byroom_worker import pdf_reader                  # noqa: E402

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
H, PH = 10, 1700


@pytest.fixture(scope="module")
def tags():
    if not os.path.exists(FONT):
        pytest.skip("DejaVu font missing")
    pdfmetrics.registerFont(TTFont("D", FONT))
    path = os.path.join(tempfile.mkdtemp(), "sheet.pdf")
    c = canvas.Canvas(path, pagesize=(2400, PH))
    t = lambda x, y, s: (c.setFont("D", H), c.drawString(x, PH - y, s))
    box = lambda x, y, w: c.rect(x - 3, PH - y - 3, w, H + 4)
    t(300, 300, "401"); t(295, 314, "OFFICE"); t(295, 328, "12"); t(315, 328, "m²")                       # stacked
    box(600, 300, 26); t(600, 300, "402"); box(630, 300, 60); t(630, 300, "MEETING"); t(600, 316, "15"); t(620, 316, "m²")
    box(860, 300, 40); t(860, 300, "משרד"[::-1]); box(905, 300, 26); t(905, 300, "403"); t(905, 316, "9"); t(915, 316, "m²")
    box(1200, 300, 26); t(1200, 300, "404"); box(1255, 300, 60); t(1255, 300, "KITCHEN")                 # boxes apart
    box(600, 700, 26); t(600, 700, "406"); box(630, 700, 60); t(630, 700, "OPEN SPACE")
    t(1500, 900, "Center"); t(1540, 900, "119"); t(1563, 900, "P.")                                       # not rooms
    t(1500, 950, "No."); t(1522, 950, "407")
    t(1500, 1000, "420"); t(1522, 1000, "mm")
    c.save()
    d = pdf_reader.read(path)
    return {x["room"]: x for x in pdf_reader.main_page(d)["tags"]}


def test_stacked_tag_unchanged(tags):
    assert tags["401"]["name"] == "OFFICE" and tags["401"]["area"] == 12 and tags["401"]["layout"] == "stacked"


def test_name_box_right_of_number(tags):
    assert tags["402"]["name"] == "MEETING" and tags["402"]["area"] == 15 and tags["402"]["layout"] == "side"
    assert tags["406"]["name"] == "OPEN SPACE"


def test_hebrew_name_box_left_of_number(tags):
    assert tags["403"]["name"] == "משרד" and tags["403"]["area"] == 9


def test_boxes_a_little_apart(tags):
    assert tags["404"]["name"] == "KITCHEN"


def test_phrases_are_not_rooms(tags):
    assert not {"119", "407", "420"} & set(tags)
