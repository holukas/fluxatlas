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

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

import fluxatlas as fa

NODE = shutil.which("node")
DRIVER = Path(__file__).parent / "js" / "smoke.mjs"
JSDOM_INSTALLED = (DRIVER.parent / "node_modules" / "jsdom").is_dir()

needs_jsdom = pytest.mark.skipif(
    NODE is None or not DRIVER.is_file() or not JSDOM_INSTALLED,
    reason="node with jsdom is not available; run `npm install` in tests/js, or open the built "
           "page in a browser instead",
)


def drive(atlas, tmp_path, name="atlas.html"):
    """Build the page, walk every view of it, and return what the driver found."""
    page = atlas.write(tmp_path / name, quiet=True)
    result = subprocess.run([NODE, str(DRIVER), str(page)],
                            capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, (
        f"the smoke driver itself failed:\n{result.stderr}")
    return json.loads(result.stdout)


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


# -- The selections that have broken it before -----------------------------------------------

@needs_jsdom
def test_a_one_variable_page_renders(ta_atlas, tmp_path):
    """One variable is the selection the renderer's fixed references break on."""
    found = drive(ta_atlas, tmp_path, "ta.html")
    assert not found["problems"], report(found)


@needs_jsdom
def test_a_page_with_the_fluxes_renders(flux_atlas, tmp_path):
    """The carbon cards, the uncertainty intervals and the sign convention, all drawn."""
    found = drive(flux_atlas, tmp_path, "flux.html")
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
