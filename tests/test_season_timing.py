"""When the season ran each year: the growing season on air temperature, the uptake period on NEE.

A season that lengthens because it begins earlier is a different finding from one that lengthens
because it ends later, so the page plots start, end and length per year, each with its slope. Two
things are guarded here. The growing season must be the one the badges already state - the same
dates, the same length and the same departures from the median - since a card and a badge on the
same page disagreeing about when a season began would be worse than having neither. And the uptake
period must be honest about a managed site: several periods in a year, or none, are reported as
such rather than smoothed into a single span.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from fluxatlas import build, stats


# -- The uptake period, on series built to show one property each ------------------------------

def _year(values_by_range, year=2015, base=1.0):
    """One calendar year of daily totals, `base` everywhere except the ranges given.

    Uptake and release are given the same magnitude, so the running mean changes sign exactly at
    the step and a period can be asserted to the day. With unequal magnitudes the crossing moves
    towards the weaker side, which is what a running mean does and not what these tests are about.
    """
    days = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")
    series = pd.Series(base, index=days, dtype=float)
    for (first, last), value in values_by_range.items():
        series.loc[first:last] = value
    return series


def test_one_sink_season_is_one_period():
    series = _year({("2015-04-10", "2015-08-20"): -1.0})
    found = stats.carbon_uptake(series, 2015)
    assert [(a.date(), b.date()) for a, b in found["periods"]] == [
        (pd.Timestamp("2015-04-10").date(), pd.Timestamp("2015-08-20").date())]
    assert found["start"] == pd.Timestamp("2015-04-10")
    assert found["end"] == pd.Timestamp("2015-08-20")
    # Both ends count: 10 April to 20 August inclusive.
    assert found["length"] == 133
    assert found["days"] == 133
    assert found["inside"] == 133


def test_one_released_day_does_not_split_a_period():
    """The smoothing is there for exactly this: an overcast day in June is not a harvest."""
    series = _year({("2015-04-10", "2015-08-20"): -1.0, ("2015-06-15", "2015-06-15"): 3.0})
    found = stats.carbon_uptake(series, 2015)
    assert len(found["periods"]) == 1
    # The day itself was a release, and the count of uptake days says so.
    assert found["days"] == 132


def test_two_crops_make_two_periods_and_the_span_runs_from_the_first_to_the_last():
    """A winter cereal and a catch crop: the span covers both, and the periods say what it holds."""
    series = _year({("2015-03-01", "2015-06-30"): -1.0, ("2015-09-01", "2015-10-31"): -1.0})
    found = stats.carbon_uptake(series, 2015)
    assert len(found["periods"]) == 2
    assert found["start"] == pd.Timestamp("2015-03-01")
    assert found["end"] == pd.Timestamp("2015-10-31")
    assert found["length"] == (found["end"] - found["start"]).days + 1
    assert found["inside"] == 122 + 61
    assert found["inside"] < found["length"]


def test_a_year_that_never_holds_uptake_has_no_period_but_keeps_its_count():
    """Scattered sink days are counted; they do not make a season."""
    series = _year({(d, d): -1.0 for d in ("2015-05-03", "2015-05-11", "2015-07-02")})
    found = stats.carbon_uptake(series, 2015)
    assert found["start"] is None and found["end"] is None and found["length"] is None
    assert found["periods"] == []
    assert found["days"] == 3


def test_a_gap_ends_a_period_rather_than_being_bridged():
    """Consecutive means consecutive dates, as in `growing_season`.

    Handed a `dropna()`'d series, counting rows would join the two halves into one period that runs
    straight through three weeks the record does not hold.
    """
    series = _year({("2015-04-01", "2015-08-31"): -1.0})
    holed = series.drop(pd.date_range("2015-06-01", "2015-06-21"))
    found = stats.carbon_uptake(holed, 2015)
    assert len(found["periods"]) == 2
    first, second = found["periods"]
    assert first[1] < pd.Timestamp("2015-06-01")
    assert second[0] > pd.Timestamp("2015-06-21")
    # Missing is the same thing whether it is absent from the index or NaN in it.
    as_nan = series.copy()
    as_nan.loc["2015-06-01":"2015-06-21"] = np.nan
    assert stats.carbon_uptake(as_nan, 2015) == found


def test_a_period_over_the_turn_of_the_year_is_cut_there_and_kept_on_both_sides():
    """The running mean and the runs are taken on the record, so neither year loses its edge.

    Four days of the period fall in the new year, fewer than a period needs on its own. Taken year
    by year they would be too short to count, and a running mean cut at 1 January would not see
    the three weeks of uptake before them.
    """
    days = pd.date_range("2014-01-01", "2015-12-31", freq="D")
    series = pd.Series(1.0, index=days)
    series.loc["2014-12-12":"2015-01-04"] = -1.0
    late = stats.carbon_uptake(series, 2014)
    early = stats.carbon_uptake(series, 2015)
    assert late["start"] == pd.Timestamp("2014-12-12")
    assert late["end"] == pd.Timestamp("2014-12-31")
    assert early["start"] == pd.Timestamp("2015-01-01")
    assert early["end"] == pd.Timestamp("2015-01-04")
    assert early["length"] == 4


def test_a_year_the_record_does_not_hold_has_no_answer():
    assert stats.carbon_uptake(_year({}), 2016) is None
    assert stats.carbon_uptake(pd.Series(dtype=float), 2015) is None


# -- The layer, on the synthetic record ---------------------------------------------------------

def _layer(atlas, keys):
    loaded = {k: atlas.loaded[k] for k in keys}
    first, last = atlas.first_year, atlas.last_year
    dates = pd.date_range(f"{first}-01-01", f"{last}-12-31", freq="D")
    day, _ = build.daily_frame(loaded, dates)
    return build.season_timing_layer(loaded, dates, day)


def test_a_timing_is_carried_only_for_the_variables_in_the_build(flux_atlas):
    assert set(flux_atlas.payload["season_timing"]) == {"TA", "NEE"}
    assert set(_layer(flux_atlas, ["TA"])) == {"TA"}
    assert set(_layer(flux_atlas, ["NEE"])) == {"NEE"}
    assert _layer(flux_atlas, ["PREC", "GPP"]) is None


def test_the_payload_carries_what_the_card_draws(flux_atlas):
    timing = flux_atlas.payload["season_timing"]
    n_years = flux_atlas.last_year - flux_atlas.first_year + 1
    for key, fields in (("TA", ("start", "end", "length")),
                        ("NEE", ("start", "end", "length", "days"))):
        entry = timing[key]
        assert [row["y"] for row in entry["years"]] == list(range(flux_atlas.first_year,
                                                                  flux_atlas.last_year + 1))
        assert set(entry["trend"]) == set(fields)
        for name in fields:
            t = entry["trend"][name]
            # Twelve complete synthetic years clear TREND_MIN_YEARS, so every slope is stated.
            assert t["n"] == n_years and "slope" in t
            assert t["lo"] <= t["slope"] <= t["hi"]
        for row in entry["years"]:
            assert 1 <= row["start"] < row["end"] <= 365
    for row in timing["NEE"]["years"]:
        assert row["periods"][0][0] == row["start"] and row["periods"][-1][1] == row["end"]
        assert row["inside"] <= row["length"]
    # The payload is JSON as it stands, with nothing the page would have to coerce.
    json.dumps(timing, allow_nan=False)


def test_the_synthetic_warming_is_recovered_as_an_earlier_start_and_a_later_end(ta_atlas):
    """The fixture warms by 0.8 K a decade, so the season has to open earlier and close later."""
    trend = ta_atlas.payload["season_timing"]["TA"]["trend"]
    assert trend["start"]["slope"] < 0
    assert trend["end"]["slope"] > 0
    assert trend["length"]["slope"] > 0
    assert trend["length"]["p"] < 0.05


def _month_row(payload, year, month):
    return next(row for row in payload["months"] if row["y"] == year and row["m"] == month)


def _badge(row, key):
    return next((b for b in row["b"] if b["k"] == key), None)


def test_the_growing_season_is_the_one_the_badges_state(full_atlas):
    """The same dates, departures and lengths as `gs_start`, `gs_end` and the season-length badges."""
    payload = full_atlas.payload
    timing = payload["season_timing"]["TA"]
    checked = 0
    for row in timing["years"]:
        for name, iso in (("start", row["s"]), ("end", row["e"])):
            when = pd.Timestamp(iso)
            month = _month_row(payload, row["y"], when.month)
            event = month["ev"][f"gs_{name}"]
            assert event["date"] == f"{when.day} {when:%B}"
            assert event["delta"] == row["delta"][name]
            badge = _badge(month, f"gs_{name}")
            assert badge is not None and f"on {when.day} {when:%B}" in badge["t"]
            checked += 1
        year = next(y for y in payload["years"] if y["y"] == row["y"])
        assert year["x"]["gslen"] == row["length"]
    assert checked == 2 * len(timing["years"])


def test_the_season_length_badges_follow_the_same_departure(full_atlas):
    payload = full_atlas.payload
    timing = payload["season_timing"]["TA"]
    earned = 0
    for row in timing["years"]:
        year = next(y for y in payload["years"] if y["y"] == row["y"])
        delta = row["delta"]["length"]
        long_, short = _badge(year, "long_season"), _badge(year, "short_season")
        assert (long_ is not None) == (delta >= build.SEASON_LENGTH_DELTA)
        assert (short is not None) == (delta <= -build.SEASON_LENGTH_DELTA)
        for badge in (long_, short):
            if badge is not None:
                assert f"ran {row['length']} days, {abs(delta)} " in badge["t"]
                assert f"record median of {timing['median']['length']:.0f}" in badge["t"]
                earned += 1
    # Otherwise the agreement above was asserted about nothing.
    assert earned > 0


def test_the_median_is_the_usual_date_the_badges_measure_against(full_atlas):
    timing = full_atlas.payload["season_timing"]["TA"]
    for row in timing["years"]:
        assert row["delta"]["start"] == int(row["start"] - timing["median"]["start"])


def test_uptake_days_are_the_pages_sink_days(flux_atlas):
    """The count is the test the page already applies to call a day a sink day."""
    payload = flux_atlas.payload
    for row in payload["season_timing"]["NEE"]["years"]:
        year = next(y for y in payload["years"] if y["y"] == row["y"])
        assert row["days"] == year["c"]["sink"]


def test_an_incomplete_year_is_drawn_but_kept_out_of_the_slope():
    rows = [dict(y=2000 + i, complete=i >= 3, start=100 - i, end=250 + i, length=150 + 2 * i)
            for i in range(12)]
    median, trends = build._timing_summary(rows, ("start", "end", "length"))
    assert median["start"] == pytest.approx(np.median([100 - i for i in range(12)]))
    for t in trends.values():
        assert t == {"n": 9}
    rows = [dict(row, complete=True) for row in rows]
    _, trends = build._timing_summary(rows, ("start",))
    assert trends["start"]["n"] == 12 and trends["start"]["slope"] == pytest.approx(-10.0)


def test_a_year_with_a_month_missing_is_not_complete():
    index = pd.date_range("2010-01-01", "2012-12-31 23:30", freq="30min")
    series = pd.Series(1.0, index=index)
    series.loc["2011-05-01":"2011-05-31 23:30"] = np.nan
    dates = pd.date_range("2010-01-01", "2012-12-31", freq="D")
    assert build._complete_years(dict(series=series), "TA", dates) == {2010, 2012}


# -- The page ---------------------------------------------------------------------------------

NODE = shutil.which("node")
JSDOM = Path(__file__).parent / "js" / "node_modules" / "jsdom"

# Loads a built page, opens each variable page named on the command line, and prints what
# `#var-season` holds there and the tooltip one row of its chart shows.
READ_SEASON = r"""
const { readFileSync } = require('fs');
const { JSDOM } = require(process.argv[2]);
const page = process.argv[3];
const keys = process.argv.slice(4);
const dom = new JSDOM(readFileSync(page, 'utf-8'), {
  url: 'https://fluxatlas.test/atlas.html', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.scrollTo = () => {};
    w.matchMedia = q => ({ media: q, matches: false, addEventListener() {},
      removeEventListener() {}, addListener() {}, removeListener() {} });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.Element.prototype.scrollIntoView = function () {};
    w.SVGElement.prototype.getComputedTextLength = function () {
      return (this.textContent || '').length * 6.6; };
  }
});
const w = dom.window;
const tick = () => new Promise(r => w.setTimeout(r, 0));
(async () => {
  await tick();
  const out = {};
  for (const key of keys) {
    w.location.hash = '#var-' + key;
    await tick(); await tick();
    const host = w.document.getElementById('var-season');
    const hit = host.querySelector('rect.hit');
    let tipText = null;
    if (hit) {
      hit.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 20, clientY: 20 }));
      tipText = w.document.getElementById('tooltip').textContent;
    }
    out[key] = { text: host.textContent, bars: host.querySelectorAll('svg rect[rx]').length,
      tip: tipText };
  }
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.mark.skipif(NODE is None or not JSDOM.is_dir(),
                    reason="node with jsdom is not available; run `npm install` in tests/js")
def test_the_card_is_drawn_on_the_temperature_and_the_exchange_page_and_nowhere_else(
        flux_atlas, tmp_path):
    page = flux_atlas.write(tmp_path / "atlas.html", quiet=True)
    script = tmp_path / "read_season.cjs"
    script.write_text(READ_SEASON, encoding="utf-8")
    result = subprocess.run([NODE, str(script), str(JSDOM), str(page), "TA", "NEE", "PREC", "GPP"],
                            capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert result.returncode == 0, result.stderr
    found = json.loads(result.stdout)
    timing = flux_atlas.payload["season_timing"]

    ta, nee = found["TA"], found["NEE"]
    assert "Growing season by year" in ta["text"]
    assert "Carbon uptake period by year" in nee["text"]
    for card in (ta, nee):
        # The axis is named in months, not in day numbers.
        assert all(m in card["text"] for m in ("Jan", "Apr", "Jul", "Oct"))
        assert not re.search(r"undefined|NaN|\[object", card["text"] + (card["tip"] or ""))
    # One bar per year for the season; at least one per year for the uptake periods.
    assert ta["bars"] == len(timing["TA"]["years"])
    assert nee["bars"] == sum(len(row["periods"]) for row in timing["NEE"]["years"])

    # The slopes are stated per decade, in words that say which way the dates moved.
    assert "days per decade" in ta["text"]
    assert re.search(r"start [\d.]+ days per decade (earlier|later)", ta["text"])
    # The exchange page uses the page's words for the sign, and says what a span means at a
    # managed site.
    assert "net uptake" in nee["text"]
    assert "managed site" in nee["text"]
    assert "Uptake days" in nee["text"]

    # The tooltip is the year's own, in the badges' words.
    first = timing["TA"]["years"][0]
    assert ta["tip"].startswith(str(first["y"]))
    when = pd.Timestamp(first["s"])
    assert f"{when.day} {when:%B} {when.year}" in ta["tip"]
    assert "Days of net uptake" in nee["tip"]

    for other in ("PREC", "GPP"):
        assert found[other]["text"] == ""
        assert found[other]["tip"] is None
