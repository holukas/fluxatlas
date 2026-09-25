"""Run the renderer, rather than only parsing it.

`test_renderer_syntax.py` proves `calendar.js` parses. That catches a stray `;` inside a string
literal, and nothing else: a page that parses and then throws on the first card looks exactly like
one that does not parse, because the renderer is one IIFE and the markup is already on screen when
it fails.

The class of bug neither a parser nor pytest can see is the renderer reading a field only one scale
carries. It rarely throws. It interpolates `undefined` into a sentence and renders it, which is how
`MONTH_NAME[state.m - 1]` put "Every undefined in the record" on the season and the year panel while
every test passed. So this drives the built page under jsdom and fails on either symptom: anything
thrown, or `undefined` reaching text a reader can see.

**Reading a page is not using one, and eight bugs went through a version of this that only read.**
Hovering or focusing a tile threw at two of the three span scales; every day-by-day chart sent a
reader back to the grid from those same two; a year's day calendar held `1 undefined 2016` in all
366 of its `aria-label`s. Each is invisible to a walk that visits routes and scans the text of the
view, so the driver now also puts the pointer and the keyboard on the tiles and the charts, opens a
day by both routes a panel offers and asserts it landed somewhere, and scans `aria-label` and
`title` alongside the prose.

The driver lives in `tests/js/`, because it is JavaScript and needs jsdom, which is not a dependency
of this package and never will be:

    cd tests/js && npm install

Without that - or without node - these tests skip, exactly as the syntax tests do, and the
repository's own instruction to open the built page in a browser stands in for them.
"""

from __future__ import annotations

import copy
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

import fluxatlas as fa
from conftest import add_fullset_extras
from fluxatlas import build

NODE = shutil.which("node")
DRIVER = Path(__file__).parent / "js" / "smoke.mjs"
JSDOM_INSTALLED = (DRIVER.parent / "node_modules" / "jsdom").is_dir()

needs_jsdom = pytest.mark.skipif(
    NODE is None or not DRIVER.is_file() or not JSDOM_INSTALLED,
    reason="node with jsdom is not available; run `npm install` in tests/js, or open the built "
           "page in a browser instead",
)


def drive_page(page):
    """Walk every view of a built page and return what the driver found."""
    result = subprocess.run([NODE, str(DRIVER), str(page)],
                            capture_output=True, text=True, encoding="utf-8", timeout=400)
    assert result.returncode == 0, (
        f"the smoke driver itself failed:\n{result.stderr}")
    return json.loads(result.stdout)


def drive(atlas, tmp_path, name="atlas.html"):
    """Build the page, walk every view of it, and return what the driver found."""
    return drive_page(atlas.write(tmp_path / name, quiet=True))


def report(found):
    return "\n".join(f"  [{p['where']}] {p['what']}" for p in found["problems"])


# -- The full page ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def full_page_walk(full_atlas, tmp_path_factory):
    """One walk of the full page, shared by the two tests that ask different questions of it.

    Walking a page is the most expensive thing in this suite, and driving it twice to ask twice was
    paying for it twice.
    """
    return drive(full_atlas, tmp_path_factory.mktemp("smoke"))


@needs_jsdom
def test_every_view_of_a_full_page_renders(full_page_walk):
    """The grid at every scale, every metric, a span panel at each scale, a day, every variable -
    each of them read, driven with the pointer and the keyboard, and selected out of."""
    found = full_page_walk
    assert not found["problems"], (
        f"{len(found['problems'])} problem(s) rendering the page:\n{report(found)}")
    assert len(found["visited"]) > 20, "the driver did not reach most of the page"


@needs_jsdom
def test_the_driver_actually_reached_every_scale_and_every_variable(full_atlas, full_page_walk):
    """A driver that silently stopped early would pass the test above by visiting nothing.

    The interactions are named here as well as the routes, and for a stronger reason: eight bugs
    shipped past a driver that visited every route and touched none of them. Coverage that is only
    added, never asserted, is coverage that can be quietly lost again.
    """
    visited = " | ".join(full_page_walk["visited"])
    for wanted in ("grid at the month scale", "grid at the season scale", "grid at the year scale",
                   "grid at the day scale", "the month panel", "the season panel",
                   "the year panel", "the day panel",
                   # The pointer and the keyboard over a tile, at each of the three span scales.
                   "grid at the month scale, hovering the tile",
                   "grid at the season scale, hovering the tile",
                   "grid at the year scale, hovering the tile",
                   "grid at the season scale, focusing the tile",
                   "grid at the year scale, focusing the tile",
                   # A chart under the cursor.
                   "chart 1 under the cursor"):
        assert wanted in visited, f"the driver never reached {wanted!r}"
    # Both routes into a day, out of each of the three span scales. The two build the address
    # differently, and the span the driver picked is the record's own, so this matches the shape
    # rather than the year.
    for panel in ("month", "season", "year"):
        for route in ("selecting a day from a chart", "selecting a day from the calendar"):
            wanted = rf"the {panel} panel \([^)]*\), {route} \(#"
            assert re.search(wanted, visited), (
                f"the driver never landed anywhere after {route} on the {panel} panel")
    for key in (v["key"] for v in full_atlas.payload["variables"]):
        assert f"the {key} page" in visited, f"the driver never opened the {key} page"
    # The newest parts of the page, each of which records that it was reached.
    assert "the address, chosen, carried, stepped through and reopened" in visited
    assert "the PREC page, the accumulated total under the cursor" in visited
    for scale in ("month", "season", "year", "day"):
        assert any(c["where"].startswith(f"grid at the {scale} scale")
                   for c in full_page_walk["checks"]["csv"]), (
            f"the driver never downloaded the grid at the {scale} scale")


# -- The accumulated total, the address and the table ----------------------------------------
#
# Each of these is a part of the page that produces something only when it is used - a chart under
# the cursor, an address after a choice, a file after a click - so each is asserted on what the
# driver recorded it doing, not only on the absence of errors. A part that stopped being drawn
# would otherwise pass every scan by producing nothing to scan.

YEARS_IN_FIXTURE = 12


@pytest.fixture(scope="session")
def flux_page_walk(flux_atlas, tmp_path_factory):
    """One walk of the page with the fluxes, shared by the tests that ask different things of it."""
    return drive(flux_atlas, tmp_path_factory.mktemp("smoke-flux"), "flux.html")


@needs_jsdom
def test_the_carbon_balance_accumulates_through_the_year(flux_atlas, flux_page_walk):
    """The standard figure of a flux site: the running total of daily NEE from 1 January, a line
    per year, on the NEE page and on the year panel - and on every other variable that sums."""
    drawn = {c["where"]: c for c in flux_page_walk["checks"]["cumulative"]}
    assert "the NEE page" in drawn
    assert any(where.startswith("the year panel") for where in drawn), (
        "the year panel drew no accumulated carbon balance")
    summed = [v["key"] for v in flux_atlas.payload["variables"] if v["agg"] == "sum"]
    for key in summed:
        assert f"the {key} page" in drawn, f"the {key} page drew no accumulated total"
    # A mean has no running total that means anything, so none is drawn for one.
    for key in (v["key"] for v in flux_atlas.payload["variables"] if v["agg"] != "sum"):
        assert f"the {key} page" not in drawn
    for where, chart in drawn.items():
        assert chart["lines"] >= YEARS_IN_FIXTURE, f"{where}: {chart['lines']} lines"
    # The sign is spelled out beside a signed running total, as it is beside every other NEE figure.
    assert re.search(r"net (uptake|release)", drawn["the NEE page"]["tip"])
    assert "1st = largest net uptake" in drawn["the NEE page"]["tip"]
    # On the year panel a date on it opens that day.
    visited = " | ".join(flux_page_walk["visited"])
    assert re.search(r"the year panel \([^)]*\), selecting a day from the accumulated total \(#",
                     visited)


@needs_jsdom
def test_the_grid_downloads_as_csv(full_atlas, full_page_walk):
    """A row per year, a column per span, the margin's year figure, units in the header, a file
    named for what it holds, and an empty cell - never `NaN` - where there is no value."""
    first = full_atlas.payload["metrics"][0]
    records = {}
    for c in full_page_walk["checks"]["csv"]:
        for scale in ("month", "season", "year", "day"):
            if c["where"].startswith(f"grid at the {scale} scale"):
                records[scale] = c
    widths = {"month": 1 + 12 + 1, "season": 1 + 4 + 1, "year": 1 + 1, "day": 1 + 366}
    for scale, want in widths.items():
        c = records[scale]
        assert re.fullmatch(rf"XX-Syn_{re.escape(first['key'])}_{scale}\.csv", c["name"]), c["name"]
        assert c["type"].startswith("text/csv")
        assert c["bom"], "without a byte-order mark a spreadsheet mangles every unit"
        assert c["rows"] == YEARS_IN_FIXTURE
        assert c["widths"] == [want], f"{scale}: rows of {c['widths']} cells against {want}"
        assert c["header"][0] == "year"
        assert all(f"({first['units']})" in h for h in c["header"][1:]), c["header"]
    assert records["month"]["header"][1].startswith("Jan ")
    assert records["month"]["header"][-1].startswith("year ")
    assert records["season"]["header"][1].startswith("Winter DJF")
    # 29 February is a column of its own and is empty in a year that has none: 2010 is not leap.
    assert records["day"]["sample"][1].startswith("2010,")
    assert ",," in records["day"]["sample"][1]


@needs_jsdom
def test_the_metric_and_scale_live_in_the_address(full_page_walk):
    """Chosen with the controls, carried through a span and back, stepped through with the
    browser's history, and restored from the address alone by a reload and by a shared link."""
    a = full_page_walk["checks"]["address"]
    assert f"metric={a['metric']}" in a["chosen"] and f"scale={a['scale']}" in a["chosen"]
    assert f"metric={a['metric']}" in a["span"]
    assert a["back"]["metric"] == a["metric"] and a["back"]["scale"] == a["scale"]
    assert a["historyBack"]["view"] == "span"
    assert a["historyForward"] == {"hash": a["back"]["hash"], "metric": a["metric"],
                                   "view": "grid"}
    assert a["reload"]["metric"] == a["metric"] and a["reload"]["scale"] == a["scale"]
    assert a["shared"]["view"] == "span" and a["shared"]["metric"] == a["metric"]
    assert a["shared"]["colouredBy"], "the span opened from a shared link ignored its metric"


# -- The caller's text -----------------------------------------------------------------------

PLANTED_COLUMN = "TA <u>raw</u>"


@needs_jsdom
def test_the_callers_text_arrives_as_text(frame, tmp_path):
    """The site, its description, the file name, every column name and the title are the caller's,
    and each is planted with a `<u>` the renderer never writes itself. The driver fails on any
    `<u>` in the page, so one that reached markup unescaped anywhere it walks is a failure, and
    this asserts that each also arrived as the literal text it was.

    The description also carries `<!--`, which the payload's own escaping once turned into `<\\!--`
    - not a JSON escape, so the page's `JSON.parse` threw and nothing was drawn."""
    path = tmp_path / "planted.parquet"
    frame.rename(columns={"TA_F": PLANTED_COLUMN}).to_parquet(path)
    atlas = fa.Atlas(path, {"TA": {"column": PLANTED_COLUMN, "qc": "TA_F_QC"}},
                     site="XX-<u>Syn</u>", site_long="Plot <u>north</u> & south <!-- open",
                     hourly=False, quiet=True)
    payload = copy.deepcopy(atlas.payload)
    payload["meta"]["provenance"] = {
        "file": "record <u>v2</u>.parquet", "bytes": 9_751_234,
        "sha256": "3f2a9c0e5b7d41aa9e0c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a69788766554433",
        "columns": {"TA": {"column": PLANTED_COLUMN, "qc": 'QC"<u>x</u>', "factor": 1.0}},
        "seasons": "DJF", "first_year": 2010, "last_year": 2021, "hourly": False,
    }
    title = "Atlas </title><u>t</u> & co"
    found = drive_page(build.render(payload, tmp_path / "planted.html", title=title))
    assert not found["problems"], report(found)

    page = found["checks"]["page"]
    assert page["title"] == title
    assert "XX-<u>Syn</u> — Plot <u>north</u> & south <!-- open" in page["footer"]["text"]
    assert "record <u>v2</u>.parquet" in page["footer"]["text"]
    assert "XX-<u>Syn</u>" in page["crumbs"]["text"]
    assert PLANTED_COLUMN in page["provenance"]["text"]
    assert 'QC"<u>x</u>' in page["provenance"]["text"]
    for where in ("footer", "provenance", "crumbs"):
        assert "u" not in page[where]["elements"], f"markup was parsed out of the {where}"


@needs_jsdom
def test_provenance_is_shown_where_the_build_records_it_and_nowhere_else(full_atlas,
                                                                          full_page_walk,
                                                                          tmp_path):
    """The file, its size and its hash in the footer, and the column, flag and factor of each
    variable in a disclosure beneath it - and a page built without any of it exactly as before."""
    page = full_page_walk["checks"]["page"]
    if "provenance" not in full_atlas.payload["meta"]:
        assert page["provenance"]["hidden"] is True
        assert page["provenance"]["hash"] is None
        assert page["footer"]["elements"] == ["code"]

    payload = copy.deepcopy(full_atlas.payload)
    sha = "ab" * 32
    payload["meta"]["provenance"] = {
        "file": "record.parquet", "bytes": 2_345_678, "sha256": sha,
        "columns": {"TA": {"column": "TA_F", "qc": "TA_F_QC", "factor": 1.0},
                    "PREC": {"column": "P_F", "qc": None, "factor": 0.0216198}},
        "seasons": "DJF", "first_year": 2010, "last_year": 2021, "hourly": False,
    }
    found = drive_page(build.render(payload, tmp_path / "provenance.html"))
    assert not found["problems"], report(found)
    shown = found["checks"]["page"]
    # The hash is written out whole - the stylesheet shortens it - so it copies whole.
    assert shown["provenance"]["hash"] == sha
    assert "record.parquet (2.2 MB, SHA-256 " + sha in shown["footer"]["text"]
    assert shown["provenance"]["hidden"] is False
    text = shown["provenance"]["text"]
    for fragment in ("TA_F", "TA_F_QC", "P_F", "none", "1 (as given)", "0.0216198",
                     "seasons DJF", "built without the hourly arrays"):
        assert fragment in text, f"{fragment!r} is missing from the provenance"


# -- What `render` writes --------------------------------------------------------------------

def _payload_of(html):
    data = re.search(r'<script id="payload" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(data.group(1))


def test_render_substitutes_every_placeholder_once(ta_atlas, tmp_path):
    """Each placeholder is found in the template and nowhere else. Chained `.replace` calls ran the
    later ones over text that already held the payload, so a site called `__TITLE__` had the title
    written into the JSON and a site called `/*__JS__*/` had the whole renderer written there."""
    payload = copy.deepcopy(ta_atlas.payload)
    site = "S __TITLE__ /*__JS__*/ <!--__LOGO__--> __FAVICON__ /*__CSS__*/"
    payload["meta"]["site"] = site
    payload["meta"]["site_long"] = "a </script> and a <!-- in the description"
    html = build.render(payload, tmp_path / "placeholders.html", title="A title").read_text(
        encoding="utf-8")
    shipped = _payload_of(html)
    assert shipped["meta"]["site"] == site
    assert shipped["meta"]["site_long"] == payload["meta"]["site_long"]
    assert html.count("<title>A title</title>") == 1
    assert "'use strict'" in html and html.count("fluxatlas - rendering engine") == 1


def test_render_escapes_the_title(ta_atlas, tmp_path):
    """The title is the caller's text and is written into markup, where a `</title>` in it would
    close the element and put the rest of it on the page."""
    html = build.render(ta_atlas.payload, tmp_path / "title.html",
                        title="A </title><script>x</script> & B").read_text(encoding="utf-8")
    assert "<title>A &lt;/title&gt;&lt;script&gt;x&lt;/script&gt; &amp; B</title>" in html


# -- The selections that have broken it before -----------------------------------------------

@needs_jsdom
def test_a_one_variable_page_renders(ta_atlas, tmp_path):
    """One variable is the selection the renderer's fixed references break on."""
    found = drive(ta_atlas, tmp_path, "ta.html")
    assert not found["problems"], report(found)


@needs_jsdom
def test_a_page_with_the_fluxes_renders(flux_page_walk):
    """The carbon cards, the uncertainty intervals and the sign convention, all drawn."""
    found = flux_page_walk
    assert not found["problems"], report(found)


@needs_jsdom
def test_a_page_without_air_temperature_renders(flux_parquet_path, tmp_path):
    """`seasonLine` read `se.TA.v` outright once. Any selection without TA is the case that found
    it, and it is only findable by running the renderer."""
    atlas = fa.Atlas(flux_parquet_path, ["NEE", "GPP"], site="XX-Syn", hourly=False, quiet=True)
    found = drive(atlas, tmp_path, "no-ta.html")
    assert not found["problems"], report(found)


@needs_jsdom
def test_a_page_with_half_year_seasons_renders(parquet_path, tmp_path):
    """A season scheme that is not the canonical four, and so is named by its months."""
    atlas = fa.Atlas(parquet_path, ["TA", "PREC"], site="XX-Syn", hourly=False, quiet=True,
                     seasons="DJFMAM")
    found = drive(atlas, tmp_path, "half-years.html")
    assert not found["problems"], report(found)


@needs_jsdom
def test_a_page_with_no_seasons_renders(parquet_path, tmp_path):
    """`--seasons none` drops a whole scale, and the scale picker has to drop with it."""
    atlas = fa.Atlas(parquet_path, ["TA", "PREC"], site="XX-Syn", hourly=False, quiet=True,
                     seasons="none")
    found = drive(atlas, tmp_path, "no-seasons.html")
    assert not found["problems"], report(found)


# -- What the renderer needs from the payload and cannot work out for itself -----------------
#
# Neither of these is visible to the driver above, and that is the point of stating them here. A
# field that stops being shipped does not throw and does not print `undefined`: the page draws
# without it, correctly in shape and wrong in fact, which is how both of them were found by hand.


def test_the_season_definitions_say_which_months_fall_in_the_previous_year(ta_atlas):
    """`seasonOfMonth` has to know which season a month sits in, and a season that crosses the new
    year is labelled by the year of its last month. Which of its months fall before that boundary
    is a property of the scheme - under `NDJF` it is November as well as December - so the renderer
    is told rather than left to assume, as it did.
    """
    defs = {d["key"]: d for d in ta_atlas.payload["season_defs"]}
    assert defs["DJF"]["shift"] == {"12": 1, "1": 0, "2": 0}
    for key in ("MAM", "JJA", "SON"):
        assert set(defs[key]["shift"].values()) == {0}, f"{key} does not cross the new year"


def test_the_year_scale_ships_the_climatology_its_charts_draw(full_atlas):
    """A year's peer group is the record, so it has one climatology rather than one per slot of the
    cycle. Without it `climFor` fell through to the month branch, looked up a month the year scale
    does not carry, and the year panel drew none of the dashed normals its own cards promise.
    """
    payload = full_atlas.payload
    keys = [v["key"] for v in payload["variables"]]
    assert set(payload["year_climatology"]) == set(keys)
    for key in keys:
        normal = payload["year_climatology"][key]
        assert normal is None or "mean" in normal
    assert any(payload["year_climatology"][key] for key in keys), (
        "no variable of a twelve-year record has a record normal, which cannot be right")


# -- Every variable alone ------------------------------------------------------------------------
#
# The renderer's recurring bug is a fixed reference to a variable a selection does not carry, and it
# is always selection-specific: `seasonLine` threw only without air temperature, and a page of
# pressure alone blanked because it offered no metric at all. So each variable no other selection
# above carries is built on its own, and the energy terms once together, since the closure ratio and
# the computed net radiation exist only in that combination.

ALONE = [["LE"], ["H"], ["NETRAD"], ["G"], ["PA"], ["USTAR"], ["TS"], ["WS"], ["LW_IN"],
         ["PPFD_IN"], ["H", "LE", "NETRAD", "G"]]


@pytest.fixture(scope="module")
def extras_path(flux_frame, tmp_path_factory):
    path = tmp_path_factory.mktemp("alone") / "extras.parquet"
    add_fullset_extras(flux_frame.copy()).to_parquet(path)
    return path


@needs_jsdom
@pytest.mark.parametrize("selection", ALONE, ids=["-".join(s) for s in ALONE])
def test_each_variable_renders_on_its_own(extras_path, tmp_path, selection):
    atlas = fa.Atlas(extras_path, selection, site="XX-Syn", hourly=False, quiet=True)
    found = drive(atlas, tmp_path)
    assert not found["problems"], report(found)
