"""The figures behind the variable page's year-by-year cards that the rest of the payload cannot give.

Most of what the variable page draws is already in the payload: the year and month rows carry each
span's value, anomaly, rank and coverage, the daily series carry every day, and the mean-day surfaces
carry every hour of every calendar month. What they cannot give is anything read off the half-hours
of a year as a whole - the spread of a year's half-hourly values, its measured extremes, the
longest run of it that was not measured - or anything that depends on the order of the record, such
as how many days of a year set a record against every day before them. Those are computed here,
once per variable, and shipped as `var_record`.

Two rules from the rest of the page hold here as well. An extreme is taken from measured records
only, since a gap-filled value is a model result and cannot set a record. And a carbon flux is stated
per half-hour as the rate the file published, in µmol m⁻² s⁻¹, exactly as the extremes card states
it, because a half-hour of "-0.93 g C m⁻²" is not a quantity anyone reads a flux in.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import variables as varreg
from .stats import r

# The percentiles of each year's half-hours the distribution card draws: the outer and the inner
# band and the median between them.
QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)

CARBON_UNITS = "g C m⁻²"
CARBON_RATE_UNITS = "µmol m⁻² s⁻¹"
CARBON_RATE_DIGITS = 1


def _runs_by_start_year(mask, hours_per_record=0.5):
    """The longest run of True in a half-hourly mask for each year, in hours, by the year it starts."""
    values = mask.to_numpy(dtype=bool)
    if not values.any():
        return {}
    edges = np.diff(np.concatenate(([0], values.astype(np.int8), [0])))
    starts = np.flatnonzero(edges == 1)
    stops = np.flatnonzero(edges == -1)
    years = np.asarray(mask.index.year)[starts]
    out = {}
    for year, length in zip(years.tolist(), (stops - starts).tolist()):
        out[year] = max(out.get(year, 0), length * hours_per_record)
    return out


def _new_records(daily, low=False):
    """Days whose measured extreme passes every day before it, counted per year.

    The running extreme is carried across days with no measurement, so a day after a gap is still
    compared with everything measured before the gap rather than with nothing.
    """
    prior = (daily.cummin() if low else daily.cummax()).ffill().shift()
    beaten = (daily < prior) if low else (daily > prior)
    return beaten.groupby(daily.index.year).sum()


def var_record_layer(loaded, first_year, last_year):
    """Per variable, the year-by-year figures of the variable page's record and year cards."""
    years = list(range(first_year, last_year + 1))
    out = {}
    for key, d in loaded.items():
        v = d["v"]
        series = d["series"]
        measured = d["measured"].reindex(series.index, fill_value=False).to_numpy(dtype=bool)

        carbon = v.units == CARBON_UNITS and v.agg == "sum"
        scale = 1.0 / varreg.UMOL_TO_GC if carbon else 1.0
        digits = CARBON_RATE_DIGITS if carbon else v.digits
        units = CARBON_RATE_UNITS if carbon else v.units
        values = series * scale
        only_measured = values.where(measured)

        def per_year(frame):
            return [r(x, digits) for x in frame.reindex(years).to_numpy(dtype=float)]

        # The spread of the half-hours, year by year. Where a variable sums and its zero is a
        # floor rather than a sign - rain, gross uptake - most half-hours sit on that floor and the
        # percentiles of all of them are a column of zeros, so only the half-hours above it count:
        # the intensity of the rain when it rained. A signed total such as the net exchange has no
        # floor, and keeps every half-hour.
        floor = v.agg == "sum" and not v.sign
        basis = values[values > 0] if floor else values.dropna()
        q = basis.groupby(basis.index.year).quantile(list(QUANTILES)).unstack()
        quantiles = {f"q{int(p * 100):02d}": per_year(q[p]) if p in q.columns
                     else [None] * len(years) for p in QUANTILES}

        year_of = only_measured.index.year
        daily_hi = only_measured.resample("D").max()
        daily_lo = only_measured.resample("D").min()

        # Records counted forwards: a record is a record against what came before it. The first
        # year with a measured day is left out, since by construction almost every one of its days
        # sets one.
        measured_days = daily_hi.dropna()
        first_measured = int(measured_days.index[0].year) if len(measured_days) else None
        with_low = bool(v.extremes["low_halfhour"])
        highs = _new_records(daily_hi)
        lows = _new_records(daily_lo, low=True) if with_low else None

        def counted(found):
            if found is None:
                return None
            return [None if first_measured is None or y <= first_measured
                    else int(found.get(y, 0)) for y in years]

        # The longest run not measured, counted in the year it starts in.
        gaps = _runs_by_start_year(pd.Series(~measured, index=series.index))
        gap_h = [r(gaps.get(y, 0.0), 1) for y in years]

        # Whether the gap-filled series stays inside what was measured. A value beyond the measured
        # range is a model result the instrument never recorded, and the page says so.
        present = values.dropna()
        seen = only_measured.dropna()
        inside = None
        if len(present) and len(seen):
            inside = dict(ok=bool(present.max() <= seen.max() and present.min() >= seen.min()),
                          lo=r(present.min(), digits), hi=r(present.max(), digits),
                          mlo=r(seen.min(), digits), mhi=r(seen.max(), digits),
                          n_over=int((present > seen.max()).sum()),
                          n_under=int((present < seen.min()).sum()))

        month = seen.index.month
        clim_lo = seen.groupby(month).min().reindex(range(1, 13))
        clim_hi = seen.groupby(month).max().reindex(range(1, 13))
        out[key] = dict(
            units=units, digits=digits, rate=bool(carbon),
            basis="half-hours above zero" if floor else "half-hourly values",
            **quantiles,
            mmin=per_year(only_measured.groupby(year_of).min()),
            mmax=per_year(only_measured.groupby(year_of).max()),
            rec_high=counted(highs), rec_low=counted(lows),
            gap_h=gap_h, inside=inside,
            clim_lo=[r(x, digits) for x in clim_lo.to_numpy(dtype=float)],
            clim_hi=[r(x, digits) for x in clim_hi.to_numpy(dtype=float)],
            meas=r(measured.mean() * 100, 1) if len(measured) else None,
        )
    return dict(quantiles=list(QUANTILES), vars=out)
