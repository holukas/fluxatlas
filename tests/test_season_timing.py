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

import numpy as np
import pandas as pd

from fluxatlas import stats


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
