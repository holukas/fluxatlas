"""Every hour of the record, as date against time of day, on each variable page.

The heatmap is drawn on a canvas, which jsdom does not have, so `smoke.mjs` can only prove that
drawing it throws nothing. These tests give the page a 2D context that records what it is handed
(`hourly_canvas.mjs`) and read the picture back cell by cell against the payload it was drawn from:
which cell an hour lands in, what colour it takes, what a gap looks like, what the pointer reads
over a cell and where selecting it goes. Whether a real browser then shows the picture is not
something jsdom can say; that was checked by reading the pixels back in one.

The synthetic record has no gaps, so one is planted in the payload before the page loads: thirty
days of NEE, every hour of each.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

import fluxatlas as fa
from conftest import add_fluxes, synthetic_frame

YEARS = 3
SELECTION = ["TA", "PREC", "SW_IN", "NEE", "GPP", "LE", "H"]
GAP = dict(key="NEE", **{"from": 101, "to": 131})

NODE = shutil.which("node")
DRIVER = Path(__file__).parent / "hourly_canvas.mjs"
SMOKE = Path(__file__).parent / "js" / "smoke.mjs"
JSDOM = (Path(__file__).parent / "js" / "node_modules" / "jsdom").is_dir()
pytestmark = pytest.mark.skipif(NODE is None or not JSDOM,
                                reason="node with jsdom is not available; run `npm install` in "
                                       "tests/js")


# -- Pages ------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def pages(tmp_path_factory):
    """Three years of meteorology and fluxes, built with and without the hourly layer."""
    tmp = tmp_path_factory.mktemp("hourly")
    path = tmp / "record.parquet"
    add_fluxes(synthetic_frame(years=YEARS)).to_parquet(path)
    return dict(
        hourly=fa.Atlas(path, SELECTION, site="XX-Syn", quiet=True)
        .write(tmp / "hourly.html", quiet=True),
        bare=fa.Atlas(path, ["TA", "NEE"], site="XX-Syn", hourly=False, quiet=True)
        .write(tmp / "bare.html", quiet=True),
    )


def payload(page):
    html = Path(page).read_text(encoding="utf-8")
    start = html.index('<script id="payload" type="application/json">')
    start = html.index(">", start) + 1
    return json.loads(html[start:html.index("</script>", start)])


def run(page, tmp_path, *, dpr, keys, hover=(), gap=GAP):
    spec = tmp_path / f"spec-{dpr}.json"
    spec.write_text(json.dumps(dict(dpr=dpr, gap=gap, keys=keys, hover=list(hover))),
                    encoding="utf-8")
    result = subprocess.run([NODE, str(DRIVER), str(page), str(spec)], capture_output=True,
                            text=True, encoding="utf-8", timeout=400)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert not out["errors"], out["errors"]
    return out


@pytest.fixture(scope="module")
def fine(pages, tmp_path_factory):
    """Drawn at a pixel ratio that gives every day its own column, so each cell can be read."""
    hover = [dict(key="NEE", day=500, hour=12), dict(key="NEE", day=110, hour=3),
             dict(key="TA", day=5, hour=0)]
    return run(pages["hourly"], tmp_path_factory.mktemp("fine"), dpr=10,
               keys=SELECTION, hover=hover)


@pytest.fixture(scope="module")
def coarse(pages, tmp_path_factory):
    """Drawn at a pixel ratio of one, where the card is narrower than the record is long."""
    return run(pages["hourly"], tmp_path_factory.mktemp("coarse"), dpr=1, keys=["NEE"])


@pytest.fixture(scope="module")
def data(pages):
    out = payload(pages["hourly"])
    values = out["hourly"]["vars"]["NEE"]["values"]
    for d in range(GAP["from"], GAP["to"]):
        values[d * 24:(d + 1) * 24] = [None] * 24
    return out


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def image(row):
    """The drawn image as an array of (hour row, column, rgb)."""
    img = row["image"]
    rgba = np.frombuffer(base64.b64decode(img["rgba"]), dtype=np.uint8)
    return rgba.reshape(img["height"], img["width"], 4)[:, :, :3].astype(int)


def grid(data, key):
    """The payload's hourly values as (day, hour), NaN where there is none."""
    h = data["hourly"]["vars"][key]
    v = np.array([np.nan if x is None else x / h["scale"] for x in h["values"]], dtype=float)
    return v.reshape(-1, 24)


# -- What is drawn ----------------------------------------------------------------------------

def test_each_cell_is_one_hour_of_one_day_with_midnight_at_the_bottom(fine, data):
    """One pixel per day and per hour, the hour counting up the axis, and NEE blue where it is
    uptake and red where it is release - which a flipped axis or a transposed index would break,
    since the synthetic site takes up carbon by day and releases it at night."""
    row = fine["vars"]["NEE"]
    assert row["canvas"] and row["role"] == "img"
    assert row["perColumn"] == 1
    assert row["smoothing"] is False, "a scaled-up cell must keep its hard edge"
    img = image(row)
    values = grid(data, "NEE")
    assert img.shape == (24, values.shape[0], 3)

    cells = img[::-1].transpose(1, 0, 2)          # (day, hour), hour 0 first
    half = np.nanquantile(np.abs(values), 0.99)
    uptake = values < -0.2 * half
    release = values > 0.2 * half
    assert uptake.sum() > 1000 and release.sum() > 100
    blue, red = cells[..., 2] - cells[..., 0], cells[..., 0] - cells[..., 2]
    assert (blue[uptake] > 0).all(), "an hour of uptake was not drawn blue"
    assert (red[release] > 0).all(), "an hour of release was not drawn red"


def test_a_gap_has_a_colour_of_its_own_and_the_legend_names_it(fine, data):
    """The planted month of missing NEE is the gap colour, every hour of it, and nothing that
    carries a value is."""
    row = fine["vars"]["NEE"]
    cells = image(row)[::-1].transpose(1, 0, 2)
    gap = hex_rgb(fine["tokens"]["--text-muted"])
    missing = np.isnan(grid(data, "NEE"))
    assert missing[GAP["from"]:GAP["to"]].all()
    is_gap = (cells == gap).all(axis=-1)
    assert (is_gap == missing).all()
    assert "no value in the file" in row["legend"]


def test_the_colour_domain_is_a_percentile_range_and_nee_diverges_about_zero(fine, data):
    """A handful of extremes does not set the scale: the hours beyond the 1st and 99th percentile
    take the end colours, which is about one hour in fifty. NEE is bounded symmetrically about zero,
    so the same depth of colour is the same magnitude of uptake as of release."""
    cold, warm = hex_rgb(fine["tokens"]["--pole-cold"]), hex_rgb(fine["tokens"]["--pole-warm"])
    ta = grid(data, "TA")
    cells = image(fine["vars"]["TA"])[::-1].transpose(1, 0, 2)
    lo, hi = np.nanquantile(ta, [0.01, 0.99])
    assert ((cells[ta < lo - 0.05] == cold).all(axis=-1)).all()
    assert ((cells[ta > hi + 0.05] == warm).all(axis=-1)).all()
    at_ends = ((cells == cold).all(axis=-1) | (cells == warm).all(axis=-1)).mean()
    assert 0.01 < at_ends < 0.04, f"{at_ends:.3f} of the hours sit at an end of the ramp"

    nee = grid(data, "NEE")
    cells = image(fine["vars"]["NEE"])[::-1].transpose(1, 0, 2)
    half = np.nanquantile(np.abs(nee), 0.99)
    sink, source = hex_rgb(fine["tokens"]["--rdylbu-1"]), hex_rgb(fine["tokens"]["--rdylbu-11"])
    assert ((cells[nee < -half - 0.002] == sink).all(axis=-1)).all()
    assert ((cells[nee > half + 0.002] == source).all(axis=-1)).all()
    legend = fine["vars"]["NEE"]["legend"]
    assert "(net uptake)" in legend and "(net release)" in legend


def test_a_dry_hour_is_neutral_rather_than_the_palest_rain(fine, data):
    prec = grid(data, "PREC")
    cells = image(fine["vars"]["PREC"])[::-1].transpose(1, 0, 2)
    neutral = hex_rgb(fine["tokens"]["--neutral-mid"])
    dry = prec == 0
    assert dry.mean() > 0.5
    assert ((cells[dry] == neutral).all(axis=-1)).all()
    assert not ((cells[prec > 0] == neutral).all(axis=-1)).any()
    assert "none" in fine["vars"]["PREC"]["legend"]


def test_narrower_than_the_record_a_column_is_several_days_greyed_by_their_gaps(coarse, data):
    """At a pixel ratio of one the card has fewer columns than the record has days. No day is
    dropped: a column averages its days, a column wholly inside the gap is the gap colour, and
    one straddling its edge is neither the gap colour nor the colour it would have without it."""
    row = coarse["vars"]["NEE"]
    per, n_days = row["perColumn"], grid(data, "NEE").shape[0]
    assert per > 1
    assert row["columns"] == -(-n_days // per)
    # Drawn at the width its columns would have in full, so a day sits under its own date.
    assert row["drawnWidth"] == pytest.approx(row["canvasWidth"] * row["columns"] * per / n_days)
    img = image(row)
    gap = hex_rgb(coarse["tokens"]["--text-muted"])
    whole = [c for c in range(row["columns"])
             if GAP["from"] <= c * per and (c + 1) * per <= GAP["to"]]
    edge = [c for c in range(row["columns"]) if c * per < GAP["from"] < (c + 1) * per
            or c * per < GAP["to"] < (c + 1) * per]
    assert whole and edge
    for c in whole:
        assert (img[:, c] == gap).all()
    for c in edge:
        assert not (img[:, c] == gap).all(axis=-1).any()


# -- What the pointer reads -------------------------------------------------------------------

def test_the_pointer_reads_the_hour_under_it_and_selecting_it_opens_the_day(fine, data):
    nee = fine["vars"]["NEE"]
    first, gap = nee["tips"]
    value = grid(data, "NEE")[500, 12]
    day = np.datetime64(data["hourly"]["start"]) + np.timedelta64(500, "D")
    y, m, d = (int(x) for x in str(day).split("-"))
    months = ["January", "February", "March", "April", "May", "June", "July", "August",
              "September", "October", "November", "December"]
    assert f"{d} {months[m - 1]} {y}" in first["text"]
    assert "12:00–13:00" in first["text"]
    assert f"{value:+.3f} g C m⁻²" in first["text"]
    assert ("(net uptake)" if value < 0 else "(net release)") in first["text"]
    assert "03:00–04:00" in gap["text"] and "no value in the file" in gap["text"]
    assert nee["clicks"][0]["hash"] == f"#{y}-{m:02d}-{d:02d}"
    assert "°C" in fine["vars"]["TA"]["tips"][0]["text"]


def test_the_canvas_says_what_it_shows(fine):
    for key in ("TA", "NEE"):
        aria = fine["vars"][key]["aria"]
        assert "every hour from" in aria and "one row per hour of the day" in aria
        assert "grey" in aria


# -- Where there is nothing to draw -----------------------------------------------------------

def test_only_the_variables_the_hourly_layer_carries_get_the_heatmap(fine, data):
    carried = set(data["hourly"]["vars"])
    assert "GPP" not in carried
    for key in SELECTION:
        assert fine["vars"][key]["canvas"] == (key in carried), key
    assert not fine["vars"]["GPP"]["card"]


def test_without_the_hourly_layer_the_page_says_so_and_draws_nothing(pages, tmp_path):
    out = run(pages["bare"], tmp_path, dpr=1, keys=["TA", "NEE"], gap=None)
    for key in ("TA", "NEE"):
        row = out["vars"][key]
        assert row["card"] and not row["canvas"]
        assert "--no-hourly" in row["text"]


def test_a_page_with_the_hourly_layer_survives_the_smoke_walk(pages):
    """Every view driven with the heatmap on the variable pages, under the smoke driver's canvas
    that draws nothing - the path a browser without a 2D context would take as well."""
    result = subprocess.run([NODE, str(SMOKE), str(pages["hourly"])], capture_output=True,
                            text=True, encoding="utf-8", timeout=400)
    assert result.returncode == 0, result.stderr
    found = json.loads(result.stdout)
    assert not found["problems"], "\n".join(f"[{p['where']}] {p['what']}"
                                            for p in found["problems"])
