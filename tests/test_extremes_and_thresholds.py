"""Two parts of the variable page: the days and half-hours at either end, and the day tests by year.

The first ranks single records, which is where a gap-filled value is most likely to pass for an
event. So what these tests hold is the rule for which records may be ranked - measured half-hours
only, and days measured to the share `date_record` demands before a day may set a record for its
date - and that the rule survives the rounding the page's daily measured share is shipped with. They
also hold the words: the ends of NEE are named from the registry and the sign, not "highest".

The second is a renderer feature over what the year rows already carry, so its tests read the page:
a card per day test that happened, the count and the longest run side by side, and a year the
instrument was mostly absent for shown as not counted rather than as a year with none.

The page is read by `extremes_text.mjs`, which borrows jsdom from `tests/js/`; without it those
tests skip, as the smoke tests do.
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

import fluxatlas as fa
from fluxatlas import build
from fluxatlas import variables as varreg
from conftest import add_fluxes, synthetic_frame

NODE = shutil.which("node")
TEXT = Path(__file__).parent / "extremes_text.mjs"
JSDOM = (Path(__file__).parent / "js" / "node_modules" / "jsdom").is_dir()
needs_jsdom = pytest.mark.skipif(NODE is None or not JSDOM,
                                 reason="node with jsdom is not available; run `npm install` in "
                                        "tests/js")

FIRST = 2010
YEARS = 4

# The planted records. The index of the synthetic frame is the middle of each window, so a record
# stamped 12:15 is the half-hour the page names 12:00-12:30.
FILLED_SPIKE = "2011-03-10 12:15"      # 55 °C, gap-filled: must never be ranked
MEASURED_SPIKE = "2011-04-10 12:15"    # 45 °C, measured: heads the half-hours
SAME_DAY = "2011-04-10 13:15"          # 44 °C, measured, same day: must not be listed twice
ALMOST_DAY = "2011-07-20"              # 43 of 48 measured, 89.6 %: rounds to 90, still refused
ENOUGH_DAY = "2011-07-21"              # 44 of 48 measured, 91.7 %: heads the days


@pytest.fixture(scope="module")
def planted(tmp_path_factory):
    """Four years with fluxes, and the records every rule below is tested against.

    The first half of 2012 carries no air temperature at all, so that year is less than 90 %
    available and its day tests cannot be counted.
    """
    frame = add_fluxes(synthetic_frame(first_year=FIRST, years=YEARS))
    frame.loc[FILLED_SPIKE, ["TA_F", "TA_F_QC"]] = [55.0, 1]
    frame.loc[MEASURED_SPIKE, ["TA_F", "TA_F_QC"]] = [45.0, 0]
    frame.loc[SAME_DAY, ["TA_F", "TA_F_QC"]] = [44.0, 0]
    for day, measured, lift in ((ALMOST_DAY, 43, 15.0), (ENOUGH_DAY, 44, 12.0)):
        rows = frame.index.normalize() == pd.Timestamp(day)
        assert rows.sum() == 48
        frame.loc[rows, "TA_F"] += lift
        frame.loc[rows, "TA_F_QC"] = [0] * measured + [1] * (48 - measured)
    gap = (frame.index >= "2012-01-01") & (frame.index < "2012-07-01")
    frame.loc[gap, "TA_F"] = np.nan
    path = tmp_path_factory.mktemp("extremes") / "extremes_HH.parquet"
    frame.to_parquet(path)
    return frame, path


@pytest.fixture(scope="module")
def atlas(planted):
    return fa.Atlas(planted[1], ["TA", "PREC", "NEE", "GPP"], site="XX-Ext", hourly=False,
                    quiet=True)


@pytest.fixture(scope="module")
def sink_atlas(tmp_path_factory):
    """NEE that is an uptake in every half-hour, so the highest end is the smallest uptake.

    The floor under the uptake differs from day to day, so each day's smallest uptake is its own
    and the high end is a ranking rather than a bound many days share.
    """
    frame = add_fluxes(synthetic_frame(first_year=FIRST, years=3))
    days = frame.index.normalize()
    floor = pd.Series(np.random.default_rng(3).uniform(0.5, 10.0, days.nunique()),
                      index=days.unique()).reindex(days).to_numpy()
    frame["NEE_VUT_REF"] = -(frame["NEE_VUT_REF"].abs() + floor)
    path = tmp_path_factory.mktemp("sink") / "sink_HH.parquet"
    frame.to_parquet(path)
    return fa.Atlas(path, ["NEE"], site="XX-Snk", hourly=False, quiet=True)


def halfhours(atlas, key):
    return atlas.payload["extreme_halfhours"]["vars"][key]


def read_page(atlas, tmp_path, *hashes):
    page = atlas.write(tmp_path / "atlas.html", quiet=True)
    result = subprocess.run([NODE, str(TEXT), str(page), *hashes], capture_output=True,
                            text=True, encoding="utf-8", timeout=400)
    assert result.returncode == 0, result.stderr
    found = json.loads(result.stdout)
    assert not found["errors"], found["errors"]
    return found


def hrefs(part, card_title):
    card = next(c for c in part["cards"] if c["title"] == card_title)
    return [[item["href"] for item in column] for column in card["items"]]


# -- Which records may be ranked ------------------------------------------------------------------

def test_the_threshold_the_page_compares_against_is_the_one_a_record_uses():
    """The page carries the daily measured share rounded to a whole percent. 43 of 48 half-hours
    is 89.6 %, which `date_record` refuses and which rounds to 90, so comparing the rounded share
    against 90 would admit exactly the days the build refused. The shipped threshold separates
    them for every count a day can have."""
    threshold = build.record_day_threshold()
    for k in range(49):
        exact = k / 48 * 100
        assert (round(exact) >= threshold) == (exact >= build.RECORD_DAY_COVERAGE), k
    assert threshold == 92


def test_only_measured_half_hours_are_ranked_and_one_per_day(atlas):
    ta = halfhours(atlas, "TA")
    stamps = [stamp for stamp, _ in ta["high"]]
    assert ta["high"][0] == ["2011-04-10T12:00", 45.0]
    # The gap-filled 55 °C is the highest value in the file and is not a record.
    assert not any(stamp.startswith("2011-03-10T12") for stamp in stamps)
    assert all(value < 55 for _, value in ta["high"])
    # The same afternoon's 44 °C would be second; one day is one entry.
    days = [stamp[:10] for stamp in stamps]
    assert len(days) == len(set(days)) == build.EXTREME_ENTRIES
    assert [value for _, value in ta["high"]] == sorted((v for _, v in ta["high"]), reverse=True)
    assert [value for _, value in ta["low"]] == sorted(v for _, v in ta["low"])


def test_every_listed_half_hour_is_measured_in_the_file(atlas, planted):
    frame = planted[0]
    for stamp, value in halfhours(atlas, "TA")["high"] + halfhours(atlas, "TA")["low"]:
        record = frame.loc[pd.Timestamp(stamp) + pd.Timedelta(minutes=15)]
        assert record["TA_F_QC"] == 0
        assert record["TA_F"] == pytest.approx(value, abs=0.05)


def test_a_carbon_half_hour_is_stated_as_the_rate_the_file_publishes(atlas, planted):
    """g C m-2 per half-hour is how a total is built, not how anyone reads a flux."""
    frame = planted[0]
    nee = halfhours(atlas, "NEE")
    assert nee["units"] == "µmol m⁻² s⁻¹" and nee["rate"]
    measured = frame.loc[frame["NEE_VUT_REF_QC"] == 0, "NEE_VUT_REF"]
    assert nee["high"][0][1] == pytest.approx(measured.max(), abs=0.05)
    assert nee["low"][0][1] == pytest.approx(measured.min(), abs=0.05)
    assert halfhours(atlas, "TA")["units"] == "°C" and not halfhours(atlas, "TA")["rate"]


def test_a_partitioned_flux_is_marked_as_one(atlas):
    """GPP's measured half-hours are its net flux's, which the page has to say."""
    assert halfhours(atlas, "GPP")["partitioned"]
    assert not halfhours(atlas, "NEE")["partitioned"]
    assert not halfhours(atlas, "TA")["partitioned"]


def test_an_end_the_registry_calls_a_floor_is_not_listed(atlas):
    prec = halfhours(atlas, "PREC")
    assert not varreg.Variable("PREC", varreg.VARIABLES["PREC"]).extremes["low_halfhour"]
    assert prec["low"] is None and prec["high"]
    assert prec["low_day"] is False
    assert halfhours(atlas, "GPP")["low"] is None
    assert halfhours(atlas, "TA")["low_day"] is True


def test_an_end_that_is_a_bound_is_stated_as_one_rather_than_listed():
    """Relative humidity reaches 100 % on hundreds of days: ten of them are ten picked by the
    calendar, so the end is reported as the bound and how many days reach it."""
    index = pd.date_range("2010-01-01", periods=48 * 30, freq="30min")
    values = pd.Series(np.linspace(40, 99, len(index)), index=index)
    values.iloc[::48] = 100.0
    rows, tie = build.halfhour_ends(values, digits=0)
    assert rows == [] and tie == {"value": 100.0, "days": 30}
    rows, tie = build.halfhour_ends(values, digits=0, low=True)
    assert tie is None and len(rows) == build.EXTREME_ENTRIES


# -- What the page lists at either end ------------------------------------------------------------

@pytest.fixture(scope="module")
def page(atlas, tmp_path_factory):
    if NODE is None or not JSDOM:
        pytest.skip("node with jsdom is not available")
    return read_page(atlas, tmp_path_factory.mktemp("page"), "var-TA", "var-NEE", "var-GPP",
                     "var-PREC")


@needs_jsdom
def test_the_days_listed_are_the_substantially_measured_ones(page, atlas):
    ext = page["var-TA"]["extremes"]
    assert ext["heading"] == "Days and half-hours at either end"
    high, low = hrefs(ext, "The days at either end")
    assert len(high) == len(low) == build.EXTREME_ENTRIES
    # 21 July is 44 of 48 measured and heads the list; 20 July was warmer and is 43 of 48.
    assert high[0] == f"#{ENOUGH_DAY}"
    assert f"#{ALMOST_DAY}" not in ext["text"] and "20 July 2011" not in ext["text"]
    card = next(c for c in ext["cards"] if c["title"] == "The days at either end")
    assert card["heads"] == ["Highest ten days (warmest)", "Lowest ten days (coldest)"]
    assert "by daily mean" in card["sub"] and "90 % measured" in card["sub"]
    # Every listed day qualifies by the rule the build states.
    meas = atlas.payload["days"]["meas"]["TA"]
    start = pd.Timestamp(atlas.payload["days"]["start"])
    threshold = atlas.payload["extreme_halfhours"]["day_meas_min"]
    for href in high + low:
        i = (pd.Timestamp(href[1:]) - start).days
        assert meas[i] >= threshold


@needs_jsdom
def test_the_half_hours_listed_link_to_their_day(page):
    ext = page["var-TA"]["extremes"]
    high, low = hrefs(ext, "The half-hours at either end")
    assert high[0] == "#2011-04-10" and high.count("#2011-04-10") == 1
    assert "#2011-03-10" not in high
    first = next(c for c in ext["cards"] if c["title"] == "The half-hours at either end")
    assert first["items"][0][0]["text"].startswith("10 Apr 2011, 12:00–12:30 45.0 °C")


@needs_jsdom
def test_the_ends_of_net_exchange_are_named_by_the_sign(page):
    ext = page["var-NEE"]["extremes"]
    card = next(c for c in ext["cards"] if c["title"] == "The half-hours at either end")
    assert card["heads"] == ["Highest ten half-hours (largest net release)",
                             "Lowest ten half-hours (largest net uptake)"]
    assert all("µmol m⁻² s⁻¹" in item["text"] for column in card["items"] for item in column)
    assert all(item["text"].endswith(", net uptake") for item in card["items"][1])
    assert "residual spikes" in card["foot"]


@needs_jsdom
def test_where_every_listed_value_is_an_uptake_the_highest_are_the_smallest(sink_atlas, tmp_path):
    """At a site that is a sink in every half-hour, the highest ten are not releases at all."""
    found = read_page(sink_atlas, tmp_path, "var-NEE")
    card = next(c for c in found["var-NEE"]["extremes"]["cards"]
                if c["title"] == "The half-hours at either end")
    assert card["heads"][0] == "Highest ten half-hours (smallest net uptake)"
    assert "release" not in card["heads"][0]


@needs_jsdom
def test_a_partitioned_flux_says_its_half_hours_are_not_observations(page):
    card = next(c for c in page["var-GPP"]["extremes"]["cards"]
                if c["title"] == "The half-hours at either end")
    assert "partitioned out of the net flux" in card["foot"]
    assert len(card["heads"]) == 1 and "The low end is not listed" in card["sub"]


# -- Threshold days, year by year -----------------------------------------------------------------

@needs_jsdom
def test_each_day_test_that_happened_has_its_own_chart(page, atlas):
    thr = page["var-TA"]["thresholds"]
    assert thr["heading"] == "Threshold days, year by year"
    tests = [f for f in atlas.payload["flags"] if f["var"] == "TA"]
    years = atlas.payload["years"]
    happened = [f for f in tests if any(row["c"][f["key"]] for row in years)]
    charts = [c["title"] for c in thr["cards"] if c["charts"]]
    assert charts == [f["label"][0].upper() + f["label"][1:] for f in happened]
    for f in tests:
        if f not in happened:
            assert f["short"] in thr["text"], f"{f['key']} is neither drawn nor said to be absent"
    assert all("Days in the year" in tip for tip in thr["tips"])


@needs_jsdom
def test_the_count_and_the_longest_run_sit_side_by_side(page, atlas):
    thr = page["var-TA"]["thresholds"]
    table = next(c for c in thr["cards"] if c["title"] == "The same counts as numbers")
    tests = [f for f in atlas.payload["flags"] if f["var"] == "TA"
             and any(row["c"][f["key"]] for row in atlas.payload["years"])]
    assert [row[0] for row in table["table"]] == [str(y) for y in range(FIRST, FIRST + YEARS)]
    frost = 1 + [f["key"] for f in tests].index("frost")
    for row, year in zip(table["table"], atlas.payload["years"]):
        if year["y"] == 2012:
            # Half the year carries no temperature, so it is not a year with no frost.
            assert all(set(cell.split(" · ")) == {"—"} for cell in row[1:]), row
            continue
        assert row[frost] == f"{year['c']['frost']} · {year['sp']['frost']}"
    hot = next(c for c in thr["cards"] if c["title"].startswith("Hot days"))
    assert re.search(r"\b2011\b", hot["foot"]), hot["foot"]


@needs_jsdom
def test_a_variable_without_day_tests_draws_nothing_for_them(page):
    assert page["var-GPP"]["thresholds"] is None
    assert page["var-GPP"]["extremes"] is not None


@needs_jsdom
def test_the_dry_spell_is_drawn_beside_the_wet_days(page, atlas):
    thr = page["var-PREC"]["thresholds"]
    wet = next(c for c in thr["cards"] if c["title"].startswith("Wet days"))
    assert "longest run of consecutive days" in wet["sub"]
    table = next(c for c in thr["cards"] if c["title"] == "The same counts as numbers")
    first = atlas.payload["years"][0]
    assert table["table"][0][1] == f"{first['c']['wet']} · {first['sp']['wet']} · " \
                                   f"{first['sp']['dry']}"


@needs_jsdom
def test_a_bound_is_stated_on_the_page_in_place_of_a_list(tmp_path):
    """Air temperature capped at 20 °C: every summer afternoon reaches the cap, so the highest
    half-hours are the cap and how many days reach it, not ten of those days."""
    frame = synthetic_frame(first_year=FIRST, years=3)
    frame["TA_F"] = frame["TA_F"].clip(upper=20.0)
    path = tmp_path / "capped_HH.parquet"
    frame.to_parquet(path)
    capped = fa.Atlas(path, ["TA"], site="XX-Cap", hourly=False, quiet=True)
    tie = halfhours(capped, "TA")["ties"]["high"]
    assert tie["value"] == 20.0 and tie["days"] > build.EXTREME_ENTRIES
    ext = read_page(capped, tmp_path, "var-TA")["var-TA"]["extremes"]
    card = next(c for c in ext["cards"] if c["title"] == "The half-hours at either end")
    assert card["heads"] == ["Highest half-hours", "Lowest ten half-hours (coldest)"]
    assert len(card["items"]) == 1, "the bound was listed as well as stated"
    assert (f"On {tie['days']:,} days at least one half-hour reaches 20.0 °C, more than a list "
            "has room for") in ext["text"]
