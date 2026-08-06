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

The driver lives in `tests/js/`, because it is JavaScript and needs jsdom, which is not a dependency
of this package and never will be:

    cd tests/js && npm install

Without that - or without node - these tests skip, exactly as the syntax tests do, and the
repository's own instruction to open the built page in a browser stands in for them.
"""

from __future__ import annotations

import json
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

@needs_jsdom
def test_every_view_of_a_full_page_renders(full_atlas, tmp_path):
    """The grid at every scale, every metric, a span panel at each scale, a day, every variable."""
    found = drive(full_atlas, tmp_path)
    assert not found["problems"], (
        f"{len(found['problems'])} problem(s) rendering the page:\n{report(found)}")
    assert len(found["visited"]) > 20, "the driver did not reach most of the page"


@needs_jsdom
def test_the_driver_actually_reached_every_scale_and_every_variable(full_atlas, tmp_path):
    """A driver that silently stopped early would pass the test above by visiting nothing."""
    found = drive(full_atlas, tmp_path)
    visited = " | ".join(found["visited"])
    for wanted in ("grid at the month scale", "grid at the season scale", "grid at the year scale",
                   "grid at the day scale", "the month panel", "the season panel",
                   "the year panel", "the day panel"):
        assert wanted in visited, f"the driver never reached {wanted!r}"
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
