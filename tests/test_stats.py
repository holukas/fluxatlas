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


def _spell_by_groupby(mask):
    """The `ne(shift()).cumsum()` form the numpy pass replaced, kept here as the reference."""
    mask = mask.fillna(False)
    blocks = mask.ne(mask.shift()).cumsum()
    runs = mask[mask].groupby(blocks[mask]).size()
    if runs.empty:
        return 0, pd.NaT
    return int(runs.max()), mask.index[blocks == runs.idxmax()][0]


AWKWARD_MASKS = {
    "never true": [False] * 6,
    "always true": [True] * 6,
    "one day": [False, False, True, False, False, False],
    "first day only": [True, False, False, False, False, False],
    "last day only": [False, False, False, False, False, True],
    "two runs of equal length": [True, True, False, True, True, False],
    "the later run is longer": [True, True, False, True, True, True],
    "alternating": [True, False, True, False, True, False],
    "a missing day inside a run": [True, True, np.nan, True, True, True],
    "a missing day at the start": [np.nan, True, True, True, False, False],
}


@pytest.mark.parametrize("case", list(AWKWARD_MASKS))
def test_the_spell_is_what_the_groupby_form_reported(case):
    """The faster implementation must not be a different estimator, ties included."""
    index = pd.date_range("2020-01-01", periods=6, freq="D")
    mask = pd.Series(AWKWARD_MASKS[case], index=index, dtype="object")
    length, start = stats.longest_spell(mask)
    was_length, was_start = _spell_by_groupby(mask)
    assert length == was_length
    assert (start == was_start) or (pd.isna(start) and pd.isna(was_start))


def test_an_empty_mask_has_no_spell():
    empty = pd.Series([], index=pd.DatetimeIndex([]), dtype=bool)
    length, start = stats.longest_spell(empty)
    assert length == 0
    assert pd.isna(start)


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


def _seasonal_year(year=2020, amplitude=12.0, offset=4.0, seed=0):
    """A year of daily means with one warm season, close enough to a real record to be a test."""
    index = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")
    rng = np.random.default_rng(seed)
    wave = offset + amplitude * -np.cos(2 * np.pi * (index.dayofyear - 1) / len(index))
    return pd.Series(wave + rng.normal(0, 1.5, len(index)), index=index)


def _season_by_rolling(daily_mean, base, span=6):
    """The row-counting form the calendar-aware one replaced, kept here as the reference."""
    above = daily_mean > base
    runs = above.rolling(span).sum()
    starts = runs[runs == span]
    if starts.empty:
        return None
    start = starts.index[0] - pd.Timedelta(days=span - 1)
    second_half = (~above).loc[f"{daily_mean.index[0].year}-07-01":]
    runs_below = second_half.rolling(span).sum()
    ends = runs_below[runs_below == span]
    end = ends.index[0] - pd.Timedelta(days=span - 1) if not ends.empty else daily_mean.index[-1]
    return dict(start=start, end=end, length=(end - start).days)


@pytest.mark.parametrize("seed", range(6))
def test_a_record_with_no_gaps_gets_the_same_season_as_before(seed):
    """The point of the reindex is gappy years. A complete year must be untouched by it."""
    year = _seasonal_year(seed=seed)
    assert stats.growing_season(year, base=5.0) == _season_by_rolling(year, base=5.0)


@pytest.mark.parametrize("seed", range(6))
def test_dropping_nothing_changes_nothing(seed):
    """Both callers pass a `dropna()`'d block, which for a complete year is the same series."""
    year = _seasonal_year(seed=seed)
    assert stats.growing_season(year, base=5.0) == stats.growing_season(year.dropna(), base=5.0)


def test_a_gap_does_not_open_a_season_out_of_scattered_warm_days():
    """Six warm days spread over three weeks are not six consecutive days above the base."""
    index = pd.date_range("2020-01-01", "2020-12-31", freq="D")
    values = pd.Series(0.0, index=index)
    values["2020-03-01":"2020-04-30"] = 15.0        # warm, but thinned to every third day below
    values["2020-06-01":"2020-09-30"] = 15.0        # the season the record actually holds
    thinned = values.copy()
    spring = (thinned.index >= "2020-03-01") & (thinned.index <= "2020-04-30")
    thinned[spring & (thinned.index.dayofyear % 3 != 0)] = np.nan
    season = stats.growing_season(thinned.dropna(), base=5.0)
    assert season["start"] in thinned.dropna().index    # a day the record holds
    assert season["start"] >= pd.Timestamp("2020-06-01")


def test_a_gap_does_not_close_the_season_either():
    """The end date is found the same way as the start, so it needs the same guarantee.

    Six cold days a week apart, with the warm days between them missing, are consecutive rows and
    not consecutive dates. Counting rows closed the season in the middle of July and dated the
    close to a day the record does not hold.
    """
    index = pd.date_range("2020-01-01", "2020-12-31", freq="D")
    values = pd.Series(0.0, index=index)
    values["2020-04-01":"2020-11-30"] = 15.0
    cold = pd.DatetimeIndex(["2020-07-05", "2020-07-12", "2020-07-19",
                             "2020-07-26", "2020-08-02", "2020-08-09"])
    punctured = values.copy()
    punctured["2020-07-05":"2020-08-09"] = np.nan     # an outage, but for six cold days in it
    punctured[cold] = 0.0
    season = stats.growing_season(punctured.dropna(), base=5.0)
    assert season["end"] == pd.Timestamp("2020-12-01")


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
