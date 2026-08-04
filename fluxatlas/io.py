"""Reading a half-hourly FLUXNET-standardized file into the layers the atlas is built from.

What this module is responsible for
-----------------------------------
Turning one file into, per selected variable, a continuous 30-minute series in the canonical unit
and a boolean saying which of its records are measured rather than modelled. Everything downstream
works from those two and never touches the file again.

Four things are decided here rather than left to the caller.

- **The timestamp.** FLUXNET stores `TIMESTAMP_START` and `TIMESTAMP_END` as `YYYYMMDDHHMM`. The
  index used is the middle of the averaging window, which is the only one of the three that cannot
  assign a record to the wrong day: an end stamp of `00:00` belongs to the previous day and a
  reader that forgets it moves a day's last half-hour into the next day.
- **Missing.** `-9999` is FLUXNET's missing value and becomes `NaN` before anything is computed. A
  file that leaves it in place would report a mean air temperature of several thousand below zero.
- **Whole years.** The grid is a whole number of years and the coverage denominators are the
  half-hours a month *should* hold, so a partial first or last year is dropped rather than
  averaged in. What was dropped is reported.
- **Units.** The registry's candidate list carries the factor onto the canonical unit, and
  `limits` is checked afterwards, so a wrong factor fails the read naming the column.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from ._console import say
from . import variables as varreg

MISSING = -9999.0
FREQ = "30min"
RECORDS_PER_DAY = 48


def _read_frame(path):
    """The file as a frame, whichever of the two formats it is in."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"no such file: {path}")
    if path.suffix.lower() in (".parquet", ".pq"):
        return pd.read_parquet(path)
    return pd.read_csv(path, low_memory=False)


def _timestamp_index(df):
    """A `TIMESTAMP_MIDDLE` DatetimeIndex, from whichever stamps the file carries.

    A frame that already arrives on a DatetimeIndex is taken at its word - that is the shape the
    upstream CH-LAE parquet files are stored in - and only the FLUXNET integer stamps are parsed.
    """
    if isinstance(df.index, pd.DatetimeIndex):
        return df.index

    def parse(col):
        return pd.to_datetime(df[col].astype("int64").astype(str), format="%Y%m%d%H%M")

    if "TIMESTAMP_START" in df.columns and "TIMESTAMP_END" in df.columns:
        start, end = parse("TIMESTAMP_START"), parse("TIMESTAMP_END")
        return start + (end - start) / 2
    if "TIMESTAMP_START" in df.columns:
        return parse("TIMESTAMP_START") + pd.Timedelta(FREQ) / 2
    if "TIMESTAMP_END" in df.columns:
        return parse("TIMESTAMP_END") - pd.Timedelta(FREQ) / 2
    if "TIMESTAMP" in df.columns:
        return parse("TIMESTAMP")
    raise ValueError("no TIMESTAMP_START/TIMESTAMP_END column and no DatetimeIndex - this does not "
                     "look like a FLUXNET-standardized file")


def _whole_years(index, first_year=None, last_year=None):
    """The first and last year the record covers completely enough to put on the grid.

    A year is taken as covered when the file reaches into January and into December of it. Records
    inside it may still be missing - that is what coverage is for - but a year the file does not
    reach at all would put an empty row on the grid and drag every normal down with it.
    """
    years = sorted(set(index.year))
    if not years:
        raise ValueError("no records")
    first = min(years)
    last = max(years)
    months_of = {y: set(index[index.year == y].month) for y in years}
    while first <= last and 1 not in months_of.get(first, set()):
        first += 1
    while last >= first and 12 not in months_of.get(last, set()):
        last -= 1
    if first_year is not None:
        first = max(first, int(first_year))
    if last_year is not None:
        last = min(last, int(last_year))
    if first > last:
        raise ValueError("no whole year in the record after trimming")
    return first, last


def available(source):
    """Which canonical variables this file can supply, and the column each would come from.

    Accepts a path or an already-read frame. Written for the callers that have to offer a choice -
    a CLI's `--list`, a GUI's variable picker - and useful on its own for finding out what an
    unfamiliar file carries.

    Only the registry's own candidate names are recognised here. A file whose columns are named to
    a local convention will come up empty, which is not an error: pass an explicit mapping to
    `read_fluxnet` instead, and see `resolve` for its shape.
    """
    df = source if isinstance(source, pd.DataFrame) else _read_frame(source)
    out = {}
    for key in varreg.known():
        v = varreg.make(key)
        for name, factor in v.candidates:
            if name in df.columns:
                qc = next((q for q in v.qc_candidates if q in df.columns), None)
                out[key] = dict(column=name, factor=factor, qc=qc, units=v.units, title=v.title)
                break
    return out


def resolve(df, keys, label="the file"):
    """Turn whatever the caller asked for into `{key: {column, factor, qc}}`.

    Three forms are accepted, and the third is what makes this usable on series that were never
    near a FLUXNET file:

    - `None` - every registry variable the frame can supply, by the registry's own candidate names.
    - `["TA", "PREC"]` - these variables, resolved by candidate name as above.
    - `{"TA": "MY_TEMPERATURE", "PREC": {"column": "RAIN", "qc": "RAIN_FLAG", "factor": 1.0}}` -
      an explicit mapping from canonical key to column. The canonical key still has to be one the
      registry describes, because that is where the units, the thresholds and the aggregation come
      from; only the column name is the caller's to choose.
    """
    present = available(df)
    if keys is None:
        keys = list(present)
    if isinstance(keys, str):
        keys = [keys]

    mapping = keys if isinstance(keys, dict) else {k: None for k in keys}
    unknown = [k for k in mapping if k not in varreg.VARIABLES]
    if unknown:
        raise KeyError(f"unknown variable(s) {', '.join(unknown)}; known keys: "
                       f"{', '.join(varreg.known())}")
    if not mapping:
        raise ValueError(f"{label} carries none of the registry variables "
                         f"({', '.join(varreg.known())}), and no mapping was given")

    specs = {}
    for key, want in mapping.items():
        if want is None:
            if key not in present:
                raise KeyError(
                    f"{label} carries no column for {key}. Looked for: "
                    + ", ".join(n for n, _ in varreg.make(key).candidates)
                    + ". Pass an explicit mapping if the column is named differently, e.g. "
                    + f'variables={{"{key}": "YOUR_COLUMN"}}')
            specs[key] = dict(present[key])
            continue
        spec = dict(column=want) if isinstance(want, str) else dict(want)
        if "column" not in spec:
            raise KeyError(f"the mapping for {key} names no column")
        if spec["column"] not in df.columns:
            raise KeyError(f"{label} has no column {spec['column']!r}, asked for by the mapping "
                           f"for {key}")
        qc = spec.get("qc")
        if qc and qc not in df.columns:
            raise KeyError(f"{label} has no column {qc!r}, named as the quality flag for {key}")
        specs[key] = dict(column=spec["column"], factor=float(spec.get("factor", 1.0)), qc=qc)
    return specs


def read_fluxnet(path, keys=None, *, first_year=None, last_year=None, quiet=False):
    """Read the selected variables out of one half-hourly FLUXNET file.

    `keys` is the selection the whole atlas is built for, in any of the forms `resolve` accepts: a
    list of canonical keys, an explicit `{key: column}` mapping for series whose columns are named
    to some other convention, or `None` for every registry variable the file can supply - which is
    a convenience for exploring a new file rather than the normal way to call this.

    Returns the mapping the builder consumes: `{key: {v, df, series, measured}}`.
    """
    path = Path(path)
    df = _read_frame(path)
    index = _timestamp_index(df)
    df = df.set_index(pd.DatetimeIndex(index))
    df = df[~df.index.duplicated(keep="first")].sort_index()

    specs = resolve(df, keys, label=path.name)
    keys = list(specs)

    first, last = _whole_years(df.index, first_year, last_year)
    dropped = sorted(set(df.index.year) - set(range(first, last + 1)))
    if dropped and not quiet:
        say(f"  incomplete year(s) dropped: {', '.join(str(y) for y in dropped)}")

    # One continuous 30-minute index over whole years. Reindexing onto it rather than onto whatever
    # the file holds is what makes a missing record and a missing row the same thing downstream,
    # which is what the coverage denominators assume.
    wanted = pd.date_range(f"{first}-01-01 00:15", f"{last}-12-31 23:45", freq=FREQ)
    df = df.reindex(wanted)

    if not quiet:
        say(f"reading {path.name}: {len(keys)} variable(s), {first}-{last}")
    out = {}
    for key in keys:
        v = varreg.make(key)
        spec = specs[key]
        v.column, v.factor, v.qc_column = spec["column"], spec["factor"], spec.get("qc")
        v.source = path.name
        v.first_year, v.last_year = first, last

        series = pd.to_numeric(df[v.column], errors="coerce")
        series = series.mask(series <= MISSING + 1).astype(float) * v.factor
        series.name = key

        lo, hi = v.limits
        clean = series.dropna()
        if len(clean) and (clean.min() < lo or clean.max() > hi):
            raise ValueError(
                f"{key}: {v.column} spans {clean.min():.3g} to {clean.max():.3g} {v.units} after "
                f"the ×{v.factor:g} unit conversion, outside the plausible range {lo} to {hi}. "
                f"Either the column is not {v.title.lower()} or its unit is not the one the "
                f"registry assumes.")

        # More than one flag code can mean "measured", and a file may carry no flag at all, in
        # which case a record is measured exactly where it is present - the most that can be
        # concluded from it.
        if v.qc_column and v.qc_column in df.columns:
            qc = pd.to_numeric(df[v.qc_column], errors="coerce")
            measured = qc.isin(list(v.measured_codes)) & series.notna()
        else:
            measured = series.notna()

        out[key] = dict(v=v, df=df, series=series, measured=measured)
        if not quiet:
            share = measured.mean() * 100
            flag = v.qc_column or "no QC column"
            say(f"  {key:<7} {v.column:<16} {flag:<18} {len(series):>8,} records  "
                f"{share:5.1f} % measured")
    return out


def span(loaded):
    """The whole-year span the atlas covers."""
    first = min(d["v"].first_year for d in loaded.values())
    last = max(d["v"].last_year for d in loaded.values())
    return first, last
