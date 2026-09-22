"""Statistical helpers shared by the atlas layers.

Ported unchanged in behaviour from the CH-LAE `build_meteo_dashboard.py`, so an atlas built here
and a dashboard built there cannot disagree about the slope of a series or the length of a spell.
An estimator may be made faster or made to handle a case the dashboard never met, but not made to
answer a complete record differently; where it now covers more, the docstring says so and a test
holds it to the old answer on the records both see.
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
    """A pandas series, or any array of numbers, as a rounded plain list.

    The same answer `r` gives value by value, without paying for its type checks on every one of
    them: the missing and non-finite values are found in one numpy pass, and what remains is a
    Python float handed to the same `round`. That keeps every figure identical to `r`'s, which a
    vectorised `np.round` would not quite do, since it rounds a scaled copy rather than the value.
    """
    if isinstance(series, pd.Series):
        values = series.to_numpy(dtype=float, na_value=np.nan)
    else:
        values = np.asarray(series, dtype=float)
    keep = np.isfinite(values).tolist()
    return [round(v, digits) if ok else None for v, ok in zip(values.tolist(), keep)]


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


def _runs(values):
    """First and one-past-last position of every run of True in a boolean array.

    The array is padded with False at both ends so that a run touching either end is closed like
    any other; the positions where the padded array changes then alternate start, stop, start,
    stop.
    """
    edges = np.flatnonzero(np.diff(np.concatenate(([False], values, [False]))))
    return edges[::2], edges[1::2]


def _first_run(values, span):
    """Position of the first day of the first run of at least `span` consecutive True, or None."""
    starts, stops = _runs(values)
    long_enough = np.flatnonzero(stops - starts >= span)
    return int(starts[long_enough[0]]) if long_enough.size else None


def longest_spell(mask):
    """Length in days and start date of the longest run of True in a daily boolean series.

    The runs are found in one numpy pass rather than by `ne(shift()).cumsum()` and a groupby. A
    build asks this for five spell definitions on every month, season and year of the record -
    about eighteen hundred calls over slices of thirty to a few hundred days - so what it costs is
    pandas call overhead rather than data volume, and the answer is unchanged: ties still go to
    the earlier run, as they did when the length came from `idxmax`.
    """
    values = np.asarray(mask.fillna(False), dtype=bool)
    starts, stops = _runs(values)
    if starts.size == 0:
        return 0, pd.NaT
    lengths = stops - starts
    longest = int(np.argmax(lengths))     # argmax takes the first of equal maxima, as idxmax did
    return int(lengths[longest]), mask.index[starts[longest]]


def growing_season(daily_mean, base, span=6):
    """Start, end and length of the growing season of one year.

    Definition used here: the season starts on the first day of the first `span` consecutive days
    with a daily mean above `base`, and ends on the first day of the first such span below `base`
    after 1 July. Several conventions are in use, so the numbers only mean something together with
    this definition.

    Consecutive means consecutive **dates**, which is why the series is put back onto a complete
    daily index before the runs are looked for. Both callers hand this a `dropna()`'d block, so a
    day without a daily mean is absent from the index rather than missing in it, and counting rows
    would let six warm days spread over three weeks open a season and then date its start to a day
    the record does not hold. Reindexed, a gap breaks a run instead of being skipped.

    A year whose days are all present is unaffected by that, so this and the CH-LAE dashboard still
    report the same season wherever the dashboard reports one at all.
    """
    if daily_mean.empty:
        return None
    # Normalized, because the index has to line up with a `date_range` of whole days for the
    # reindex to find anything at all.
    daily_mean = daily_mean.set_axis(daily_mean.index.normalize())
    days = pd.date_range(daily_mean.index[0], daily_mean.index[-1], freq="D")
    above = (daily_mean > base).reindex(days, fill_value=False).to_numpy()
    # A day the record does not hold is neither above the base nor below it. Taking `~above` alone
    # would call it a day below and let a gap close the season; on a record with no gaps every day
    # is present and this is exactly `~above`.
    below = daily_mean.notna().reindex(days, fill_value=False).to_numpy() & ~above
    opens = _first_run(above, span)
    if opens is None:
        return None
    start = days[opens]
    midsummer = days.searchsorted(pd.Timestamp(f"{daily_mean.index[0].year}-07-01"))
    closes = _first_run(below[midsummer:], span)
    end = days[midsummer + closes] if closes is not None else daily_mean.index[-1]
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
