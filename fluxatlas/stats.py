"""Statistical helpers shared by the atlas layers.

Ported unchanged in behaviour from the CH-LAE `build_meteo_dashboard.py`, so an atlas built here
and a dashboard built there cannot disagree about the slope of a series or the length of a spell.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.stats import kendalltau, theilslopes


def r(value, digits=2):
    """Round for JSON, mapping every flavour of missing onto `null`.

    Rounding here rather than in the browser is what keeps the embedded payload small: the daily
    series alone runs to several thousand records and full float repr triples its size.
    """
    if value is None:
        return None
    if isinstance(value, (np.floating, np.integer)):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if pd.isna(value):
        return None
    return round(float(value), digits)


def rlist(series, digits=2):
    """A pandas series as a rounded plain list."""
    return [r(v, digits) for v in series.to_numpy()]


def trend(yearly):
    """Theil-Sen slope per decade of a yearly series, with its 95 % interval and Kendall's tau.

    Theil-Sen rather than least squares because a single extreme year does not move it, and
    Kendall's tau because it tests a monotonic trend without assuming normal residuals. Years
    without a value are dropped rather than interpolated.
    """
    yearly = yearly.dropna()
    years = yearly.index.to_numpy(dtype=float)
    values = yearly.to_numpy(dtype=float)
    slope, intercept, low, high = theilslopes(values, years, alpha=0.95)
    tau, pvalue = kendalltau(years, values)
    return dict(slope=slope * 10, low=low * 10, high=high * 10, tau=tau, pvalue=pvalue,
                fit=pd.Series(intercept + slope * years, index=yearly.index))


def longest_spell(mask):
    """Length in days and start date of the longest run of True in a daily boolean series."""
    mask = mask.fillna(False)
    blocks = mask.ne(mask.shift()).cumsum()
    runs = mask[mask].groupby(blocks[mask]).size()
    if runs.empty:
        return 0, pd.NaT
    return int(runs.max()), mask.index[blocks == runs.idxmax()][0]


def growing_season(daily_mean, base, span=6):
    """Start, end and length of the growing season of one year.

    Definition used here: the season starts on the first day of the first `span` consecutive days
    with a daily mean above `base`, and ends on the first day of the first such span below `base`
    after 1 July. Several conventions are in use, so the numbers only mean something together with
    this definition.
    """
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


def resample_agg(series, freq, how):
    """Resample with a sum that keeps an all-missing period missing.

    `agg('sum')` reports 0 for a period with no records at all, which for precipitation is the
    difference between "it did not rain" and "the gauge was not read".
    """
    if how == "sum":
        return series.resample(freq).sum(min_count=1)
    return series.resample(freq).agg(how)


def doy365(index):
    """Day of year with 29 February folded onto 1 March, so one array serves every year.

    A daily normal is a smooth function of the date, so sharing one slot between 29 February and
    1 March costs nothing measurable and buys an array that is indexed the same way in a leap year
    and in an ordinary one.
    """
    doy = np.asarray(index.dayofyear)
    leap = np.asarray(index.is_leap_year)
    return np.where(leap & (doy > 59), doy - 1, doy)


def rank_of(values, mask, first="high"):
    """Rank of every qualifying value, with the others left out of the ranking.

    `first` names the end that takes rank 1: `"high"` for a quantity where more is more of it, and
    `"low"` where the informative extreme is the negative one. Net ecosystem exchange is the case
    that needs it - the micrometeorological sign convention makes the most negative month the
    largest carbon uptake, so ranking it from the top would call the biggest sink the last of its
    calendar month.
    """
    ranked = values.where(mask)
    return ranked.rank(ascending=(first == "low"), method="min").astype("Int64")


def percentile_domain(values, lo=2, hi=98, symmetric=False):
    """A colour domain that a handful of extreme months cannot flatten.

    The tail of a precipitation distribution is long enough that a domain taken from the maximum
    leaves every ordinary month the same pale colour, which is the failure this avoids.
    """
    clean = np.asarray([v for v in values if v is not None and not pd.isna(v)], dtype=float)
    if clean.size == 0:
        return [0.0, 1.0]
    a, b = float(np.percentile(clean, lo)), float(np.percentile(clean, hi))
    if symmetric:
        m = max(abs(a), abs(b)) or 1.0
        return [-m, m]
    if a == b:
        b = a + 1.0
    return [a, b]
