"""What a site states about a series beyond the series itself: its source flag, its correction, and
its agreement with a reference station.

Each part here is opt-in, and each describes the record rather than judging it. A source flag says
which sensor, record or calibration a value came from; a measured twin says what a correction did;
a reference station says whether the difference against an independent instrument stayed level. The
page states all three as figures and corrects nothing.

Everything is computed from series the reader has already put on the half-hourly grid, so nothing
here touches the input file again. The reference station is the exception, being a second file, and
`read_reference` puts it on the same grid by the same rule the reader uses.
"""

from __future__ import annotations

import string

import numpy as np
import pandas as pd

from . import variables as varreg
from .io import FREQ, MISSING, _raw_stamps, _read_frame, columns_of
from .stats import r, rlist

# The fewest overlapping measured half-hours a reference comparison is drawn from. Below this a
# monthly residual rests on a handful of records and its rolling median on fewer months than it
# spans; the comparison is withheld and the page says why.
REFERENCE_MIN_OVERLAP = 10_000

# Complete years compared either side of a hardware change. The year of the change itself is left
# out, so an outage at the changeover does not sit inside either window.
STEP_YEARS = 3

# The window of the rolling median drawn through the monthly residual, and how many of its months
# must carry a value. A year is the shortest window that removes the seasonal cycle of a residual.
ROLL_MONTHS = 12
ROLL_MIN_MONTHS = 6


# ----------------------------------------------------------------------------------------------
# The source flag
# ----------------------------------------------------------------------------------------------

def source_codes(d):
    """The codes a variable's source flag is described by, with their long and short labels.

    With a legend, every code of the legend in its order, whether or not the record carries it, so
    the shares are indexed by the legend the caller wrote. Without one, the codes the record carries.
    """
    spec = d["v"].source_flag
    legend = spec["legend"]
    if legend:
        return [(code, labels[0], labels[1]) for code, labels in legend.items()]
    present = sorted(int(c) for c in d["source"].dropna().unique())
    return [(code, f"code {code}", f"code {code}") for code in present]


def source_onehot(d):
    """One boolean column per code, and a column saying which records carry the flag at all."""
    flag = d["source"]
    codes = source_codes(d)
    onehot = pd.DataFrame({i: (flag == code).to_numpy() for i, (code, _, _) in enumerate(codes)},
                          index=flag.index)
    return onehot, flag.notna()


def source_shares(d, group):
    """The share of each span's flagged records under each code, in percent.

    `group` turns a per-record frame into one row per span by summing. The denominator is the
    records of the span that carry the flag, so the shares of a span add up to a hundred whatever
    part of it the flag reaches; a span with no flagged record has no shares.
    """
    onehot, flagged = source_onehot(d)
    counts = group(onehot.astype(float))
    total = group(flagged.astype(float).to_frame("n"))["n"]
    return counts.div(total.replace(0, np.nan), axis=0) * 100


def source_table(shares):
    """Each span's source shares as the payload carries them: whole percent, trailing zeros dropped.

    The same shape `build.fill_table` gives the fill shares, so the two read alike on the page.
    """
    out = {}
    for idx, values in zip(shares.index, shares.to_numpy(dtype=float)):
        if np.isnan(values).all():
            continue
        levels = [0 if np.isnan(x) else int(round(x)) for x in values]
        while levels and not levels[-1]:
            levels.pop()
        if levels:
            out[idx] = levels
    return out


def source_layer(d, years):
    """What the variable page says of a source flag: the codes, and each year's share under each."""
    v = d["v"]
    spec = v.source_flag
    codes = source_codes(d)
    year = pd.Series(d["source"].index.year, index=d["source"].index)
    shares = source_shares(d, lambda frame: frame.groupby(year).sum()).reindex(years)
    out = dict(column=spec["column"], codes=[c for c, _, _ in codes],
               long=[lg for _, lg, _ in codes], short=[sh for _, _, sh in codes],
               given=bool(spec["legend"]),
               shares=[None if np.isnan(row).all() else [r(x, 1) for x in row]
                       for row in shares.to_numpy(dtype=float)])
    ref = spec.get("reference_code")
    if ref is not None:
        out["reference_code"] = ref
        hit = d["source"] == ref
        if hit.any():
            out["reference_from"] = f"{hit.idxmax():%Y-%m-%d}"
    return out


# ----------------------------------------------------------------------------------------------
# A correction, read back out of the file
# ----------------------------------------------------------------------------------------------

def _figures(delta):
    """The summary of one set of differences between the corrected and the uncorrected series."""
    return dict(n=int(len(delta)), n_changed=int((delta != 0).sum()),
                min=r(delta.min(), 6), max=r(delta.max(), 6), mean=r(delta.mean(), 6),
                distinct=int(delta.nunique()))


class _Blank(dict):
    """A format map that leaves a placeholder it cannot fill empty rather than failing."""

    def __missing__(self, key):
        return ""


def fill_note(text, units, **figures):
    """A caller's note with `{units}` and any of the correction's placeholders filled in.

    A placeholder the build has no figure for is left empty rather than failing the build, so a
    note written for one record still renders against a record that lacks the hardware change it
    describes. Any other brace is left as it was written.
    """
    if not text:
        return None
    values = _Blank(units=units, **{k: v for k, v in figures.items() if v is not None})
    known = {"units", "break_ts", "offset", "shield_max"}
    out = []
    for literal, field, spec, conversion in string.Formatter().parse(text):
        out.append(literal)
        if field is None:
            continue
        if field in known:
            out.append(format(values[field], spec) if values[field] != "" else "")
        else:
            out.append("{" + field + (("!" + conversion) if conversion else "")
                       + ((":" + spec) if spec else "") + "}")
    return "".join(out)


def correction_layer(key, d):
    """What a correction did, measured as the corrected series minus its uncorrected twin.

    The two columns differ by exactly the correction, so the correction is read back out of the
    file rather than quoted. Where the build names a source flag, the difference is also stated per
    era of that flag - a correction across a hardware change is usually a constant for the older
    era and something else for the reference era - with the constant itself where an era has one.

    A site may pass `checks`, a callable taking the differences and the source flag beside them, to
    assert the shape of its own correction. It is the site's statement about its own record; a
    failure stops the build naming the variable.
    """
    v = d["v"]
    options = d.get("options", {})
    delta = (d["series"] - d["raw"]).round(6).dropna()
    if delta.empty:
        raise ValueError(f"{key}: {v.column} and its uncorrected twin {v.raw_column} never both "
                         f"carry a value, so the correction cannot be read")
    out = dict(column=v.raw_column, **_figures(delta))
    year = delta.groupby(delta.index.year)
    out["yearly"] = [dict(y=int(y), mean=r(part.mean(), 6), min=r(part.min(), 6),
                          max=r(part.max(), 6), n=int(len(part))) for y, part in year]

    flag = d.get("source")
    era = None if flag is None else flag.reindex(delta.index)
    figures = {}
    if era is not None:
        legend = (v.source_flag or {}).get("legend") or {}
        eras = []
        for code in sorted(era.dropna().unique()):
            part = delta[era == code]
            label = legend[int(code)][0] if int(code) in legend else f"code {int(code)}"
            eras.append(dict(code=int(code), label=label,
                             offset=r(part.iloc[0], 6) if part.nunique() == 1 else None,
                             **_figures(part)))
        out["eras"] = eras
        ref = v.source_flag.get("reference_code")
        if ref is not None and (flag == ref).any():
            # Before the change is before the first record of the reference era, by the clock:
            # a later era of the same instrument that a flag codes apart - the probe handled,
            # heated - is not the era the change replaced.
            first = flag[flag == ref].index[0]
            before, after = delta[delta.index < first], delta[era == ref]
            out["reference_code"] = ref
            out["reference_from"] = f"{first:%Y-%m-%d}"
            figures["break_ts"] = f"{first.day} {first:%b %Y}"
            if len(before) and before.nunique() == 1:
                out["offset"] = r(before.iloc[0], 6)
                figures["offset"] = f"{before.iloc[0]:+.4f} {v.units}"
            elif len(before):
                figures["offset"] = "an era-wide offset"
            if len(after):
                out["reference_min"] = r(after.min(), 6)
                figures["shield_max"] = f"{-after.min():.3f} {v.units}"

    checks = options.get("checks")
    if checks is not None:
        try:
            checks(delta, era)
        except Exception as exc:
            raise ValueError(f"{key}: the correction check failed: {exc}") from exc

    note = fill_note(options.get("correction_note"), v.units, **figures)
    if note:
        out["note"] = note
    return out


# ----------------------------------------------------------------------------------------------
# A reference station
# ----------------------------------------------------------------------------------------------

def solar_night(starts, lat, lon, utc_offset):
    """Whether the sun is below the horizon at the middle of each half-hour.

    The position of the sun depends on the clock and the place alone, so this split introduces no
    further measurement. diive's potential radiation is used where diive is installed, so a split
    made here agrees with one made in a diive workflow; otherwise the NOAA solar-position formula,
    which agrees with it to well within a half-hour and only decides which side of the horizon a
    record sits on. `starts` are window starts in the file's local standard time, `utc_offset` the
    hours that time is ahead of UTC.
    """
    middle = pd.DatetimeIndex(starts) + pd.Timedelta(minutes=15)
    try:
        import diive as dv
        pot = dv.variables.potrad(timestamp_index=middle, lat=lat, lon=lon, utc_offset=utc_offset)
        return np.asarray(pot) <= 0
    except Exception:  # diive absent, or an interface it no longer has: the formula serves
        pass
    doy = middle.dayofyear.to_numpy(dtype=float)
    hour = middle.hour.to_numpy(dtype=float) + middle.minute.to_numpy(dtype=float) / 60
    gamma = 2 * np.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqtime = 229.18 * (0.000075 + 0.001868 * np.cos(gamma) - 0.032077 * np.sin(gamma)
                       - 0.014615 * np.cos(2 * gamma) - 0.040849 * np.sin(2 * gamma))
    decl = (0.006918 - 0.399912 * np.cos(gamma) + 0.070257 * np.sin(gamma)
            - 0.006758 * np.cos(2 * gamma) + 0.000907 * np.sin(2 * gamma)
            - 0.002697 * np.cos(3 * gamma) + 0.00148 * np.sin(3 * gamma))
    true_solar = hour * 60 + eqtime + 4 * lon - 60 * utc_offset
    hour_angle = np.radians(true_solar / 4 - 180)
    phi = np.radians(lat)
    cos_zenith = (np.sin(phi) * np.sin(decl)
                  + np.cos(phi) * np.cos(decl) * np.cos(hour_angle))
    return cos_zenith <= 0


def read_reference(path, columns):
    """The reference station's file, as numeric columns with the stamps it states.

    The stamps are returned as the file states them, because each variable may shift them by its
    own amount before they are put on the grid: a station on `TIMESTAMP_END` beside a product on the
    window start is a shift of half an hour, and that is the caller's to state.
    """
    header = columns_of(path)
    missing = [c for c in columns if c not in header]
    if missing:
        raise KeyError(f"{path.name} has no column(s) {', '.join(missing)}, named as reference "
                       f"columns")
    stamps = [c for c in ("TIMESTAMP_START", "TIMESTAMP_END", "TIMESTAMP") if c in header]
    df = _read_frame(path, usecols=list(dict.fromkeys(stamps + list(columns))))
    raw, _ = _raw_stamps(df, label=path.name)
    keep = ~np.asarray(pd.isna(raw))
    df, raw = df[keep], raw[keep]
    values = {c: pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float, copy=True)
              for c in columns}
    for c in values:
        values[c][values[c] <= MISSING + 1] = np.nan
    return raw, values


def on_grid(stamps, values, shift_minutes, index, factor=1.0):
    """One reference column shifted, floored onto the half-hourly windows, and aligned to `index`.

    `factor` brings the station's unit onto the variable's, as a column's factor does in the reader:
    a station that publishes pressure in hPa beside a product in kPa is a factor of 0.1.

    Flooring after the shift makes the stated shift forgiving in the way the reader is: a station
    stamped at the end of its window lands on the right window whether it is shifted back by a
    quarter or by a half of an hour.
    """
    starts = (pd.DatetimeIndex(stamps) + pd.Timedelta(minutes=float(shift_minutes))).floor(FREQ)
    series = pd.Series(values * float(factor), index=starts)
    series = series[~series.index.duplicated(keep="first")]
    return series.reindex(index)


def _roll(monthly):
    return monthly.rolling(ROLL_MONTHS, center=True, min_periods=ROLL_MIN_MONTHS).median()


def reference_layer(key, d, ref, site):
    """The residual of the product against a reference station, or the reason it is withheld.

    `ref` is `{column, series, split}`: the station's column on the product's grid and whether to
    split it into night and day. Only measured records of the product take part, since a gap-filled
    value compared with a station says something about the gap-filling model.

    A nearby station run by another institution takes the weather out of the difference and leaves
    the instruments, which is what makes the residual a check rather than a restatement. Where the
    two stand at different heights a constant offset is expected; what the chart shows is whether
    it stayed constant. Where the build names a source flag with a reference code, the residual is
    also compared across the hardware change it marks.
    """
    v = d["v"]
    product = d["series"].where(d["measured"].to_numpy(dtype=bool))
    both = pd.DataFrame({"p": product, "s": ref["series"]}).dropna()
    out = dict(column=ref["column"], split=bool(ref["split"]))
    if len(both) < REFERENCE_MIN_OVERLAP:
        out["withheld"] = (f"only {len(both):,} measured half-hours overlap the reference, "
                           f"fewer than the {REFERENCE_MIN_OVERLAP:,} a comparison needs")
        return out

    residual = both["p"] - both["s"]
    windows = [("all", "all hours", np.ones(len(both), dtype=bool))]
    if ref["split"]:
        night = solar_night(both.index, site["lat"], site["lon"], site["utc_offset"])
        windows += [("night", "night", night), ("day", "day", ~night)]
    out.update(n=int(len(both)), start=f"{both.index[0]:%Y-%m-%d}",
               stop=f"{both.index[-1]:%Y-%m-%d}",
               r=r(both["p"].corr(both["s"]), 4), mean=r(residual.mean(), 4),
               sd=r(residual.std(), 4))

    months = pd.date_range(residual.index[0].to_period("M").to_timestamp(),
                           residual.index[-1], freq="MS")
    out["months"] = [f"{m:%Y-%m}" for m in months]
    drawn = windows[1:] if ref["split"] else windows
    out["series"] = []
    for name, label, mask in drawn:
        monthly = residual[mask].resample("MS").mean().reindex(months)
        out["series"].append(dict(key=name, label=label, values=rlist(monthly, 3),
                                  smooth=rlist(_roll(monthly), 3)))

    spec = v.source_flag
    flag = d.get("source")
    if spec and spec.get("reference_code") is not None and flag is not None \
            and (flag == spec["reference_code"]).any():
        year = int(flag[flag == spec["reference_code"]].index[0].year)
        years = np.asarray(both.index.year)
        before = (years >= year - STEP_YEARS) & (years <= year - 1)
        after = (years >= year + 1) & (years <= year + STEP_YEARS)
        steps = []
        for name, label, mask in windows:
            lo, hi = residual[before & mask], residual[after & mask]
            b = lo.mean() if len(lo) else np.nan
            a = hi.mean() if len(hi) else np.nan
            steps.append(dict(key=name, window=label, before=r(b, 4), after=r(a, 4),
                              step=r(a - b, 4), n_before=int(len(lo)), n_after=int(len(hi))))
        out.update(break_year=year, steps=steps, step_years=STEP_YEARS)

    yearly = []
    for y in sorted(set(both.index.year)):
        sel = np.asarray(both.index.year) == y
        row = dict(y=int(y), n=int(sel.sum()), mean=r(residual[sel].mean(), 4),
                   sd=r(residual[sel].std(), 4))
        for name, _, mask in windows[1:]:
            part = residual[sel & mask]
            row[name] = r(part.mean(), 4) if len(part) else None
        yearly.append(row)
    out["yearly"] = yearly
    return out
