"""The estimators. Each is checked against a series whose answer is known by construction."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from fluxatlas import stats


# -- Rounding for JSON ---------------------------------------------------------------------------

@pytest.mark.parametrize("value", [None, np.nan, float("inf"), float("-inf"), pd.NA, pd.NaT])
def test_every_flavour_of_missing_rounds_to_none(value):
    assert stats.r(value) is None


def test_rounding_returns_plain_floats():
    out = stats.r(np.float32(1.23456), 2)
    assert out == 1.23
    assert type(out) is float


def test_rlist_rounds_a_series():
    series = pd.Series([1.234, np.nan, 5.678])
    assert stats.rlist(series, 1) == [1.2, None, 5.7]


# -- Trend ---------------------------------------------------------------------------------------

def test_a_known_slope_is_recovered_per_decade():
    """Theil-Sen is fitted per year and reported per decade, which is a factor of ten."""
    years = np.arange(2000, 2021)
    series = pd.Series(0.3 * (years - 2000) + 5.0, index=years)
    out = stats.trend(series)
    assert np.isclose(out["slope"], 3.0)          # 0.3 per year -> 3.0 per decade
    assert np.isclose(out["tau"], 1.0)
    assert out["pvalue"] < 0.001


def test_one_wild_year_does_not_move_the_slope():
    """The reason for Theil-Sen rather than least squares."""
    years = np.arange(2000, 2021)
    clean = pd.Series(0.3 * (years - 2000) + 5.0, index=years)
    spiked = clean.copy()
    spiked.iloc[10] += 500.0
    assert np.isclose(stats.trend(clean)["slope"], stats.trend(spiked)["slope"], atol=0.2)


def test_a_flat_series_has_no_significant_trend():
    years = np.arange(2000, 2021)
    series = pd.Series([5.0] * len(years), index=years)
    out = stats.trend(series)
    assert np.isclose(out["slope"], 0.0)
    assert out["pvalue"] > 0.05 or np.isnan(out["pvalue"])


# -- Spells --------------------------------------------------------------------------------------

def test_longest_spell_finds_the_run_and_where_it_starts():
    index = pd.date_range("2020-01-01", periods=10, freq="D")
    mask = pd.Series([True, True, False, True, True, True, True, False, True, False], index=index)
    length, start = stats.longest_spell(mask)
    assert length == 4
    assert start == pd.Timestamp("2020-01-04")


def test_a_mask_that_is_never_true_has_no_spell():
    index = pd.date_range("2020-01-01", periods=5, freq="D")
    length, start = stats.longest_spell(pd.Series([False] * 5, index=index))
    assert length == 0
    assert pd.isna(start)


def test_missing_days_do_not_bridge_a_spell():
    index = pd.date_range("2020-01-01", periods=5, freq="D")
    mask = pd.Series([True, True, np.nan, True, True], index=index).astype("object")
    assert stats.longest_spell(mask)[0] == 2


# -- Growing season ------------------------------------------------------------------------------

def test_the_growing_season_starts_at_the_first_run_above_the_base():
    index = pd.date_range("2020-01-01", periods=366, freq="D")
    values = np.full(366, 0.0)
    values[100:280] = 15.0                        # a clean block above the base
    season = stats.growing_season(pd.Series(values, index=index), base=5.0, span=6)
    assert season["start"] == index[100]
    assert season["end"] == index[280]
    assert season["length"] == 180


def test_a_year_that_never_warms_has_no_season():
    index = pd.date_range("2020-01-01", periods=366, freq="D")
    series = pd.Series(np.full(366, -5.0), index=index)
    assert stats.growing_season(series, base=5.0) is None


# -- Day of year ---------------------------------------------------------------------------------

def test_29_february_folds_onto_1_march():
    leap = pd.DatetimeIndex(["2020-02-28", "2020-02-29", "2020-03-01", "2020-12-31"])
    ordinary = pd.DatetimeIndex(["2021-02-28", "2021-03-01", "2021-12-31"])
    assert list(stats.doy365(leap)) == [59, 59, 60, 365]
    assert list(stats.doy365(ordinary)) == [59, 60, 365]


# -- Gap-preserving sums -------------------------------------------------------------------------

def test_a_period_with_no_records_sums_to_missing_not_zero():
    """For precipitation this is the difference between no rain and no measurement."""
    index = pd.date_range("2020-01-01", periods=96, freq="30min")
    series = pd.Series(np.nan, index=index)
    series.iloc[:48] = 1.0
    daily = stats.resample_agg(series, "D", "sum")
    assert daily.iloc[0] == 48.0
    assert pd.isna(daily.iloc[1])


# -- Colour domains ------------------------------------------------------------------------------

def test_a_domain_ignores_the_extreme_tail():
    values = list(np.linspace(0, 100, 200)) + [10_000.0]
    lo, hi = stats.percentile_domain(values)
    assert hi < 200


def test_a_symmetric_domain_is_centred_on_zero():
    lo, hi = stats.percentile_domain(list(np.linspace(-3, 8, 100)), symmetric=True)
    assert np.isclose(lo, -hi)


def test_an_empty_domain_has_a_usable_fallback():
    assert stats.percentile_domain([None, np.nan]) == [0.0, 1.0]


def test_ranking_leaves_out_what_does_not_qualify():
    values = pd.Series([5.0, 9.0, 7.0, 1.0])
    mask = pd.Series([True, False, True, True])
    ranks = stats.rank_of(values, mask)
    assert [None if pd.isna(x) else int(x) for x in ranks] == [2, None, 1, 3]
