"""Reading a half-hourly FLUXNET-standardized file into the layers the atlas is built from.

What this module is responsible for
-----------------------------------
Turning one file into, per selected variable, a continuous 30-minute series in the canonical unit
and a boolean saying which of its records are measured rather than modelled. Everything downstream
works from those two and never touches the file again.

Four things are decided here rather than left to the caller.

- **The timestamp.** FLUXNET stores `TIMESTAMP_START` and `TIMESTAMP_END` as `YYYYMMDDHHMM`, and
  the index is the start, which the file already holds. A 30-minute window falls inside one day,
  one month and one hour whichever end of it is named, so nothing on the page depends on the
  choice. The end stamp is the exception, and is why it is never used as it stands: an end of
  `00:00` belongs to the previous day, so taking it at face value moves a day's last half-hour into
  the next day.
- **Missing.** `-9999` is FLUXNET's missing value and becomes `NaN` before anything is computed.
- **Whole years.** The grid is a whole number of years and the coverage denominators are the
  half-hours a month *should* hold, so a partial first or last year is dropped rather than
  averaged in. What was dropped is reported.
- **Units.** The registry's candidate list carries the factor onto the canonical unit, and
  `limits` is checked afterwards, so a wrong factor fails the read naming the column.

Why the file is read twice
--------------------------
A FLUXNET FULLSET file is wide and long: the CH-Oe2 record below is 248 columns over twenty-one
years of half-hours, 552 MB, and an atlas of six variables needs about twenty of those columns.
So the header is read first, the selection is resolved against the column *names* alone, and only
then is the file read for the dozen or two columns that survived. Reading the header costs a fifth
of a second; the projected read of that file takes 0.6 s against 21 s for the whole of it, and
holds 59 MB rather than 697 MB.

This is why `available` and `resolve` take a list of column names rather than a frame - they have
to be answerable before any data is read. Both still accept a frame, which is what makes them
usable on a series that is already in memory.
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

PARQUET_SUFFIXES = (".parquet", ".pq")

# The stamps `_timestamp_index` knows how to build an index from. Kept beside the reader because a
# projected read has to ask for them before it knows which one it will use.
TIMESTAMP_COLUMNS = ("TIMESTAMP_START", "TIMESTAMP_END", "TIMESTAMP")


def columns_of(source):
    """The column names of a file, a frame, or a list of names, without reading any data.

    This is the cheap half of the read. For a CSV it parses the header line and nothing else; for
    a parquet file it reads the footer schema. Either answers in well under a second on a file
    whose full read takes half a minute.
    """
    if isinstance(source, pd.DataFrame):
        return list(source.columns)
    if isinstance(source, (list, tuple, set, pd.Index)):
        return list(source)

    path = Path(source)
    if not path.exists():
        raise FileNotFoundError(f"no such file: {path}")
    if path.suffix.lower() in PARQUET_SUFFIXES:
        import pyarrow.parquet as pq
        schema = pq.read_schema(path)
        # A pandas index stored in the file is not a column the caller may ask for.
        return [n for n in schema.names if not n.startswith("__index_level_")]
    return list(pd.read_csv(path, nrows=0).columns)


def _read_frame(path, usecols=None):
    """The file as a frame, whichever of the two formats it is in, carrying `usecols` only.

    `usecols=None` reads everything, which is what a caller exploring an unfamiliar frame wants and
    what the tests do; the atlas itself always names its columns.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"no such file: {path}")

    if path.suffix.lower() in PARQUET_SUFFIXES:
        # A parquet index is restored from the file metadata whether or not it was named in
        # `columns`, so a projected read still arrives on its DatetimeIndex.
        return pd.read_parquet(path, columns=usecols)

    if usecols is not None:
        # pyarrow's CSV reader is multithreaded and roughly six times faster than the C parser on
        # a file this wide. It is stricter, so anything it refuses falls back rather than failing
        # the read.
        try:
            return pd.read_csv(path, usecols=usecols, engine="pyarrow")
        except Exception:
            pass
    return pd.read_csv(path, usecols=usecols, low_memory=False)


def _timestamp_index(df):
    """The start of each averaging window, from whichever stamps the file carries.

    `TIMESTAMP_START` is what a FLUXNET file already holds, so it is what the index is: no derived
    value to explain, and the label a reader sees is the one in the column they read. Every figure
    on the page would be the same on any of the three stamps, because a 30-minute window falls
    inside one day, one month and one hour whichever end of it is named. The exception is the end
    stamp, which is why it is the one stamp that is never used as it stands: an end of `00:00`
    belongs to the previous day, so a reader taking it at face value moves a day's last half-hour
    into the next day.

    A frame that already arrives on a DatetimeIndex is floored onto the window grid rather than
    taken at its word. Local products are stamped at the start of the window or at its middle, and
    flooring maps both onto the same start; without it, a middle-stamped file would land between
    the grid's points and read as empty.
    """
    if isinstance(df.index, pd.DatetimeIndex):
        return df.index.floor(FREQ)

    def parse(col):
        return pd.to_datetime(df[col].astype("int64").astype(str), format="%Y%m%d%H%M")

    if "TIMESTAMP_START" in df.columns:
        return parse("TIMESTAMP_START")
    if "TIMESTAMP_END" in df.columns:
        return parse("TIMESTAMP_END") - pd.Timedelta(FREQ)
    if "TIMESTAMP" in df.columns:
        return parse("TIMESTAMP").dt.floor(FREQ)
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

    Accepts a path, an already-read frame, or a list of column names. Given a path it reads the
    header and nothing else, so it stays cheap on a file too large to want in memory - which is
    what makes it usable as the first step of a read, and as a CLI's `--list` or a GUI's variable
    picker.

    Only the registry's own candidate names are recognised here. A file whose columns are named to
    a local convention will come up empty, which is not an error: pass an explicit mapping to
    `read_fluxnet` instead, and see `resolve` for its shape.
    """
    columns = set(columns_of(source))
    out = {}
    for key in varreg.known():
        v = varreg.make(key)
        for name, factor in v.candidates:
            if name in columns:
                qc = next((q for q in v.qc_candidates if q in columns), None)
                out[key] = dict(column=name, factor=factor, qc=qc, units=v.units, title=v.title)
                break
    return out


def resolve(source, keys, label="the file"):
    """Turn whatever the caller asked for into `{key: {column, factor, qc}}`.

    Three forms are accepted, and the third is what makes this usable on series that were never
    near a FLUXNET file:

    - `None` - every registry variable the frame can supply, by the registry's own candidate names.
    - `["TA", "PREC"]` - these variables, resolved by candidate name as above.
    - `{"TA": "MY_TEMPERATURE", "PREC": {"column": "RAIN", "qc": "RAIN_FLAG", "factor": 1.0}}` -
      an explicit mapping from canonical key to column. The canonical key still has to be one the
      registry describes, because that is where the units, the thresholds and the aggregation come
      from; only the column name is the caller's to choose.

    `source` is a path, a frame, or a list of column names - the resolution is a question about
    names, and answering it before the data is read is what lets the read be projected.
    """
    columns = set(columns_of(source))
    present = available(columns)
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
        if spec["column"] not in columns:
            raise KeyError(f"{label} has no column {spec['column']!r}, asked for by the mapping "
                           f"for {key}")
        qc = spec.get("qc")
        if qc and qc not in columns:
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

    # The header first, so the selection can be resolved against the column names; only then is the
    # file read, for the selected columns and the stamps that date them. On a 248-column FULLSET
    # file that is the difference between reading twenty columns and reading all of them.
    header = columns_of(path)
    specs = resolve(header, keys, label=path.name)
    keys = list(specs)

    needed = [c for c in TIMESTAMP_COLUMNS if c in header]
    for spec in specs.values():
        for col in (spec["column"], spec.get("qc")):
            if col and col not in needed:
                needed.append(col)

    # The uncertainty columns are resolved the same way and against the same header, so they cost
    # one more pass over a list of names rather than another read of the file.
    #
    # Only where the variable came from a column the registry knows. `NEE_VUT_REF_RANDUNC` is the
    # uncertainty of `NEE_VUT_REF`; attaching it to a series the caller mapped in from somewhere
    # else would be inventing an error bar for data it does not describe.
    unc = {}
    for key in keys:
        known_columns = {name for name, _ in varreg.make(key).candidates}
        unc[key] = (varreg.uncertainty(key, header)
                    if specs[key]["column"] in known_columns else [])
        for component in unc[key]:
            for col in component["columns"]:
                if col not in needed:
                    needed.append(col)

    df = _read_frame(path, usecols=needed)
    index = _timestamp_index(df)
    df = df.set_index(pd.DatetimeIndex(index))
    df = df[~df.index.duplicated(keep="first")].sort_index()

    # Half-hourly is what this reads, and an hourly file lands on the half-hourly grid rather than
    # missing it: every hour is also a half hour. Reindexed onto 30 minutes it would come out as a
    # record that is half missing, with every coverage figure on the page halved and nothing to say
    # why, so the spacing is checked rather than inferred. The mode rather than the mean, because a
    # record with genuine gaps still has 30 minutes as its commonest step.
    if len(df.index) > 1:
        steps = pd.Series(df.index).diff().dropna()
        common = steps.mode()
        if len(common) and common.iloc[0] != pd.Timedelta(FREQ):
            raise ValueError(
                f"{path.name}: its records are {common.iloc[0]} apart, and this reads half-hourly "
                f"records. Resample to 30 minutes first, or see the documentation on input that is "
                f"not half-hourly.")

    first, last = _whole_years(df.index, first_year, last_year)
    dropped = sorted(set(df.index.year) - set(range(first, last + 1)))
    if dropped and not quiet:
        say(f"  incomplete year(s) dropped: {', '.join(str(y) for y in dropped)}")

    # One continuous 30-minute index over whole years. Reindexing onto it rather than onto whatever
    # the file holds is what makes a missing record and a missing row the same thing downstream,
    # which is what the coverage denominators assume.
    wanted = pd.date_range(f"{first}-01-01 00:00", f"{last}-12-31 23:30", freq=FREQ)

    # A DatetimeIndex is floored onto this grid, so the only way to miss it is to be on a different
    # frequency altogether - hourly records, say, or ten-minute ones. That failure would otherwise
    # surface as "the column is present but empty", which sends a reader looking at the wrong
    # thing, so it is diagnosed here by what actually caused it.
    if len(df.index) and not len(df.index.intersection(wanted)):
        raise ValueError(
            f"{path.name}: none of its {len(df.index):,} timestamps land on the half-hourly grid "
            f"this reader builds, which runs 00:00, 00:30, 01:00 and so on. The first stamp is "
            f"{df.index[0]:%Y-%m-%d %H:%M}. Half-hourly records are what this reads; an hourly or "
            f"ten-minute file needs resampling to 30 minutes first.")
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

        # A FLUXNET file routinely carries a column it never filled - on the CH-Oe2 record
        # `LE_CORR` and `H_CORR` are `-9999` in all 368,208 records. The header scan cannot see
        # that, so a column reserved but never written resolves exactly like a real one and would
        # otherwise reach the page as a variable with an empty grid and no explanation.
        if not len(clean):
            # Against the header, not the frame: the frame holds only what was projected, so the
            # alternative worth suggesting is exactly the one that was not read.
            others = [n for n, _ in v.candidates if n != v.column and n in header]
            raise ValueError(
                f"{key}: {v.column} is present in {path.name} but every one of its "
                f"{len(series):,} records is missing, so there is nothing to build from. "
                + (f"Also present, and worth trying: {', '.join(others)}. " if others else "")
                + f'Name the column explicitly to override the registry\'s choice, e.g. '
                  f'variables={{"{key}": "{others[0] if others else "YOUR_COLUMN"}"}}.')

        if clean.min() < lo or clean.max() > hi:
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

        # The uncertainty travels through the same unit conversion as the flux, because an interval
        # in one unit around a figure in another says nothing. Its components stay apart: they are
        # aggregated differently, and the builder is what knows the scale being aggregated to.
        components = []
        for component in unc[key]:
            cols = [pd.to_numeric(df[c], errors="coerce").mask(lambda s: s <= MISSING + 1)
                    .astype(float) * v.factor for c in component["columns"]]
            if not any(c.notna().any() for c in cols):
                continue                        # published as a column, filled with nothing
            components.append(dict(kind=component["kind"], label=component["label"],
                                   columns=list(component["columns"]), series=cols))
        v.uncertainty_note = varreg.uncertainty_note(components)

        out[key] = dict(v=v, df=df, series=series, measured=measured, uncertainty=components)
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
