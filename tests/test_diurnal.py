"""Through the day: the month-by-hour surface, the mean day of each calendar month, and at what hour
a span differed from the record.

A monthly mean cannot say whether a warm month was warm by night or by day, or whether a dry summer
lost its uptake at midday or across the whole day. The surface can, and it is small enough to build
for every variable of every page: twelve months by twenty-four hours per year, independent of the
hourly arrays a `--no-hourly` build leaves out.

The payload tests hold the surface to the monthly figures the rest of the page states, since the two
describe one record: a mean variable's twenty-four hours average to its monthly mean, and a summed
one's add up to its mean daily total.
"""

from __future__ import annotations

import calendar
import json

import numpy as np
import pandas as pd
import pytest

import fluxatlas as fa
from fluxatlas import build
from fluxatlas import variables as varreg


def surface(layer, key):
    """One variable's surface as floats: years x months x hours, and the record's months x hours."""
    s = layer["vars"][key]
    as_float = lambda xs: np.array([np.nan if x is None else x for x in xs], float) / s["scale"]
    years = as_float(s["values"]).reshape(layer["n_years"], 12, 24)
    return years, as_float(s["mean"]).reshape(12, 24), as_float(s["lo"]).reshape(12, 24), \
        as_float(s["hi"]).reshape(12, 24)


def loaded_from(series_by_key):
    """The reader's shape, for the layer alone: a variable and its half-hourly series."""
    return {key: dict(v=varreg.make(key), series=series) for key, series in series_by_key.items()}


def half_hours(first_year, last_year):
    return pd.date_range(f"{first_year}-01-01", f"{last_year}-12-31 23:30", freq="30min")


def days(first_year, last_year):
    return pd.date_range(f"{first_year}-01-01", f"{last_year}-12-31", freq="D")


# -- The payload ----------------------------------------------------------------------------------

def test_every_variable_carries_a_surface_without_the_hourly_arrays(flux_atlas):
    """The surface is what a `--no-hourly` page draws its diurnal parts from, so it is always built."""
    layer = flux_atlas.payload["diurnal"]
    assert flux_atlas.payload["hourly"] is None
    assert layer is not None
    assert set(layer["vars"]) == {v["key"] for v in flux_atlas.payload["variables"]}
    for s in layer["vars"].values():
        assert len(s["values"]) == layer["n_years"] * 12 * 24
        assert len(s["mean"]) == len(s["lo"]) == len(s["hi"]) == 12 * 24
        assert all(x is None or isinstance(x, int) for x in s["values"])


def test_the_surface_does_not_depend_on_the_hourly_arrays(parquet_path):
    """Building the hourly arrays or not changes nothing the surface says."""
    with_hourly = fa.Atlas(parquet_path, ["TA"], hourly=True, quiet=True).payload
    without = fa.Atlas(parquet_path, ["TA"], hourly=False, quiet=True).payload
    assert with_hourly["hourly"] is not None and without["hourly"] is None
    assert without["diurnal"] is not None
    assert with_hourly["diurnal"] == without["diurnal"]


def test_a_mean_variable_averages_to_its_monthly_mean(full_atlas, frame):
    """Twenty-four hourly means of a complete month average to the month's own mean.

    Checked against the file rather than against the tile, which is rounded to a tenth: the only
    slack left is the surface's own storage step.
    """
    layer = full_atlas.payload["diurnal"]
    years, *_ = surface(layer, "TA")
    ta = frame["TA_F"]
    monthly = ta.groupby([ta.index.year, ta.index.month]).mean()
    step = 1 / layer["vars"]["TA"]["scale"]
    for (y, m), mean in monthly.items():
        cells = years[y - layer["first_year"], m - 1]
        assert np.mean(cells) == pytest.approx(mean, abs=step / 2 + 1e-9)


@pytest.mark.parametrize("key", ["PREC", "NEE", "GPP", "RECO"])
def test_a_summed_variable_is_its_mean_total_per_hour(flux_atlas, key):
    """For a total, the twenty-four hours of a month add up to its mean daily total.

    That is what makes "mean total per hour" the honest quantity: the surface and the monthly tiles
    describe the same carbon and the same rain. Without the factor of two a half-hour's mean would
    be stated per hour, and every figure would be half the carbon the month holds.
    """
    layer = flux_atlas.payload["diurnal"]
    s = layer["vars"][key]
    assert s["total"] and s["units"].endswith(" per hour")
    years, *_ = surface(layer, key)
    checked = 0
    for row in flux_atlas.payload["months"]:
        total = row[key]["v"]
        if total is None or row[key]["avail"] < 100:
            continue
        cells = years[row["y"] - layer["first_year"], row["m"] - 1]
        n_days = calendar.monthrange(row["y"], row["m"])[1]
        # Each stored cell is rounded to one step of the scale, so the sum can drift by 24 steps a
        # day; the monthly total is rounded to its own digits.
        slack = 24 * n_days * 0.5 / s["scale"] + 1
        assert cells.sum() * n_days == pytest.approx(total, abs=slack)
        checked += 1
    assert checked > 100


def test_the_record_surface_is_the_mean_of_the_years(flux_atlas):
    """The record's surface weights every year alike, and its band holds the years it summarises."""
    layer = flux_atlas.payload["diurnal"]
    for key in layer["vars"]:
        years, record, lo, hi = surface(layer, key)
        step = 1 / layer["vars"][key]["scale"]
        assert record == pytest.approx(np.nanmean(years, axis=0), abs=step)
        assert (lo <= record + step).all() and (record <= hi + step).all()


def test_the_surface_finds_the_diurnal_cycle_at_the_hour_it_was_imposed(full_atlas):
    """Each cell is the hour of the day it is labelled with, in the file's own time.

    The synthetic temperature's diurnal term is `-5 cos(2 pi (hour - 14) / 24)` in the stamps of the
    file, so it bottoms out at 14:00 and peaks at 02:00; an hour is the two half-hours that begin in
    it, so the extremes fall in the cells either side of those instants. Shortwave is zero before
    dawn and after dusk. A surface read in the wrong zone, or reversed, or off by the stamp, moves
    both, which a monthly mean cannot show and a reader of the surface would take as a fact.
    """
    _, record, *_ = surface(full_atlas.payload["diurnal"], "TA")
    for month in record:
        assert int(np.argmin(month)) in (13, 14)
        assert int(np.argmax(month)) in (1, 2)
    _, sw, *_ = surface(full_atlas.payload["diurnal"], "SW_IN")
    assert np.allclose(sw[:, :6], 0) and np.allclose(sw[:, 18:], 0)
    assert (sw[:, 11] > 0).all() and (sw[:, 12] > 0).all()


def test_the_surface_recovers_the_imposed_warming(full_atlas):
    """0.8 K per decade over twelve years: the last year stands above the first at every hour."""
    years, *_ = surface(full_atlas.payload["diurnal"], "TA")
    rise = np.nanmean(years[-3:], axis=(0, 1)) - np.nanmean(years[:3], axis=(0, 1))
    assert rise.mean() == pytest.approx(0.8 * 0.9, abs=0.25)


def test_a_cell_the_product_does_not_cover_is_left_empty():
    """Availability gates a year's cell, exactly as it gates every monthly statistic on the page."""
    index = half_hours(2000, 2011)
    series = pd.Series(10.0 + index.hour.to_numpy(), index=index)
    # Twenty days of July 2005 missing: two thirds of every hour of that month.
    series[(index.year == 2005) & (index.month == 7) & (index.day <= 20)] = np.nan
    # Two half-hours of June 2005 missing: the month is still covered past the 90 % line.
    series[(index.year == 2005) & (index.month == 6) & (index.day == 3) & (index.hour == 5)] = np.nan
    layer = build.diurnal_layer(loaded_from({"TA": series}), days(2000, 2011), None)
    years, record, *_ = surface(layer, "TA")
    assert np.isnan(years[5, 6]).all()
    assert not np.isnan(years[5, 5]).any()
    assert not np.isnan(record).any()
    assert record[6, 5] == pytest.approx(15.0)


def test_a_record_too_short_for_a_normal_carries_no_surface():
    """Below `MIN_NORMAL_YEARS` there is no record to set a span against, so nothing is offered."""
    last = 2000 + build.MIN_NORMAL_YEARS - 2
    index = half_hours(2000, last)
    series = pd.Series(np.sin(np.arange(len(index))), index=index)
    assert build.diurnal_layer(loaded_from({"TA": series}), days(2000, last), None) is None

    last = 2000 + build.MIN_NORMAL_YEARS - 1
    index = half_hours(2000, last)
    series = pd.Series(np.sin(np.arange(len(index))), index=index)
    assert build.diurnal_layer(loaded_from({"TA": series}), days(2000, last), None) is not None


def test_the_surface_is_small_enough_to_build_for_every_variable(flux_atlas):
    """About 25 to 30 KB per variable over twenty-one years.

    The years are about 1.2 KB each on the CH-Oe2 record; the record's surface and its band are a
    fixed four or five on top, whatever the length of the record.
    """
    layer = flux_atlas.payload["diurnal"]
    for key, s in layer["vars"].items():
        per_year = len(json.dumps(s["values"], separators=(",", ":"))) / layer["n_years"]
        assert per_year < 1400, key
        assert len(json.dumps(s, separators=(",", ":"))) < 30_000, key


def test_the_departure_scale_is_what_most_of_the_record_stays_within(flux_atlas):
    """The span panels saturate at the 95th percentile of every year's departure from the record."""
    layer = flux_atlas.payload["diurnal"]
    years, record, *_ = surface(layer, "NEE")
    departure = np.abs(years - record)
    spread = layer["vars"]["NEE"]["spread"]
    share = (departure <= spread + 1 / layer["vars"]["NEE"]["scale"]).mean()
    assert 0.93 <= share <= 0.97
