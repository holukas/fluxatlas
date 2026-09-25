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
- **Units.** The registry's candidate list carries the factor onto the canonical unit - including
  for a candidate the caller named explicitly, which is a choice of column and not of unit - and
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

import re
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

# A FULLSET partitioning product, named for its method and for the u* selection of the NEE it was
# partitioned from: `GPP_NT_CUT_REF` comes out of `NEE_CUT_REF`, `RECO_DT_VUT_USTAR50` out of
# `NEE_VUT_USTAR50`, `GPP_NT_VUT_25` out of `NEE_VUT_25`.
_PARTITIONED = re.compile(r"(?:GPP|RECO)_(?:NT|DT)_((?:VUT|CUT)_[A-Z0-9]+)")


def _partitioned_from(column):
    """The quality flag of the NEE a partitioned column came from, or None for any other column."""
    match = _PARTITIONED.fullmatch(column)
    return f"NEE_{match.group(1)}_QC" if match else None


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
        # a file this wide. It is stricter, so a file it refuses as malformed - a row with more
        # fields than the header, say, which the C parser tolerates - falls back rather than
        # failing the read.
        #
        # Only that refusal falls back. pyarrow reports it as `ArrowInvalid`, which pandas re-raises
        # as a `ParserError`; which of the two arrives depends on the pandas version. Anything else
        # is a failure the C parser would meet as well, and one of them is worse than a wasted
        # second read: a `MemoryError` retried with a slower parser that holds more per column
        # asks for more memory than the attempt that just ran out of it.
        import pyarrow as pa
        try:
            return pd.read_csv(path, usecols=usecols, engine="pyarrow")
        except (pd.errors.ParserError, pa.ArrowInvalid):
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
    return _window_starts(*_raw_stamps(df))


def _window_starts(stamps, on_grid):
    """The raw stamps as window starts: as they stand where they already are, floored otherwise."""
    return stamps if on_grid else stamps.floor(FREQ)


def _parse_stamps(column, label="the file"):
    """A FLUXNET `YYYYMMDDHHMM` column as a DatetimeIndex, with `NaT` where a row has no stamp.

    Split arithmetically rather than through strings: formatting 368,000 integers as text and
    parsing them back with a format string took half a second per column on a 21-year record, and
    this takes a fraction of that. A column that is not twelve digits throughout goes the old way,
    so whatever that path refused, and the error it gave, is unchanged.

    An empty stamp is not an error here. A CSV saved from a spreadsheet routinely ends in a row of
    empty fields, and a row that cannot be dated cannot be placed on the grid either, so it comes
    back as `NaT` for `read_fluxnet` to drop and count. A stamp that is present but is not a number
    is different - it says the column is in some other format, not that one row is empty - and is
    refused naming the column and the value, since nothing below could say which of the two it was.
    """
    name = column.name if column.name is not None else "the timestamp column"
    stated = column.notna().to_numpy()
    if not pd.api.types.is_numeric_dtype(column):
        # Read as text, an empty field may arrive as "" or as whitespace rather than as missing.
        stated = stated & column.astype("string").fillna("").str.strip().ne("").to_numpy(bool)
    numbers = pd.to_numeric(column.where(stated), errors="coerce")
    unreadable = stated & numbers.isna().to_numpy()
    if unreadable.any():
        raise ValueError(
            f"{label}: {name} holds {column[unreadable].iloc[0]!r}, which is not a number. Stamps "
            f"are read as the integer YYYYMMDDHHMM that FLUXNET writes, 201601010030 for "
            f"2016-01-01 00:30; convert the column to that form, or write the file as parquet on a "
            f"DatetimeIndex.")

    present = numbers.notna().to_numpy()
    values = numbers.to_numpy()[present].astype("int64")
    if values.size and (values.min() < 10**11 or values.max() >= 10**12):
        parsed = pd.DatetimeIndex(pd.to_datetime(pd.Series(values).astype(str),
                                                 format="%Y%m%d%H%M"))
    else:
        year, rest = np.divmod(values, 10**8)
        month, rest = np.divmod(rest, 10**6)
        day, rest = np.divmod(rest, 10**4)
        hour, minute = np.divmod(rest, 100)
        parsed = pd.DatetimeIndex(pd.to_datetime(dict(year=year, month=month, day=day, hour=hour,
                                                      minute=minute)))
    if present.all():
        return parsed
    out = np.full(len(column), np.datetime64("NaT", np.datetime_data(parsed.dtype)[0]))
    out[present] = parsed.to_numpy()
    return pd.DatetimeIndex(out)


def _raw_stamps(df, label="the file"):
    """The timestamps as the file states them, and whether they already name the window start.

    Kept apart from `_timestamp_index` because the **spacing** of a file is a fact about these and
    not about the index built from them. Flooring maps a middle-stamped 30-minute record onto the
    window it belongs to, which is why it is done; it maps three ten-minute records onto that same
    window just as willingly, and de-duplication then drops two of them. Measured after that, a
    ten-minute file is indistinguishable from a half-hourly one, so it is measured before.
    """
    if isinstance(df.index, pd.DatetimeIndex):
        # FLUXNET timestamps are local standard time: no zone, and no daylight saving. An index
        # that carries a zone - which any pipeline working in UTC writes - cannot be compared with
        # the zone-free grid at all, and used to fail much later as a file none of whose stamps
        # land on the grid, quoting a first stamp that visibly does. Converting it is not done
        # here, because the offset that is standard at the site is not something the file states:
        # UTC and a site on UTC+1 differ by a whole hour, and a guess would move every diurnal
        # cycle on the page by that much without a word.
        if df.index.tz is not None:
            raise ValueError(
                f"{label}: its timestamps carry the time zone {df.index.tz}, and this reads the "
                f"local standard time FLUXNET uses, with no zone and no daylight saving. Convert "
                f"the index to the site's standard time and drop the zone before reading, e.g. "
                f'df.index = df.index.tz_convert("Etc/GMT-1").tz_localize(None) for a site on '
                f"UTC+1. The sign of an Etc/GMT zone is inverted: UTC+1 is Etc/GMT-1. A regional "
                f"zone such as Europe/Zurich observes daylight saving and is not standard time.")
        return df.index, False

    def parse(col):
        return _parse_stamps(df[col], label)

    if "TIMESTAMP_START" in df.columns:
        return parse("TIMESTAMP_START"), True
    if "TIMESTAMP_END" in df.columns:
        return parse("TIMESTAMP_END") - pd.Timedelta(FREQ), True
    if "TIMESTAMP" in df.columns:
        return parse("TIMESTAMP"), False
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
        if key not in out:
            derived = _derived_spec(key, columns)
            if derived:
                out[key] = dict(derived, units=v.units, title=v.title)
    return out


# ----------------------------------------------------------------------------------------------
# Variables computed from the file's own columns
#
# Net radiation is the one case: a FULLSET file publishes its four components and not the sum, so
# a file that would otherwise never supply it can. Kept here, apart from the reader, because the
# rest of the read then needs to know nothing about it: `_add_derived` writes the series and a
# quality flag into the frame under the names the spec gives, and from that point on the derived
# variable is read, converted, checked and flagged exactly as a column the file carried would be.
# ----------------------------------------------------------------------------------------------

def _derived_spec(key, columns):
    """The resolution of a variable computed from its components, or None where it cannot be.

    `column` is the name the page shows for the series and `qc` the name of the flag written for
    it; neither is a column of the file. The flag names the component flags it is built from, so
    `--list` states what the measured share of the result rests on.
    """
    found = varreg.derivation(key, columns)
    if found is None:
        return None
    flags = [qc for _, _, qc in found["components"] if qc]
    return dict(column=found["column"], factor=1.0, qc=" & ".join(flags) or None,
                components=found["components"])


def _source_columns(spec):
    """The columns of the file a resolved variable is read from."""
    if "components" in spec:
        return [c for _, name, qc in spec["components"] for c in (name, qc) if c]
    return [c for c in (spec["column"], spec.get("qc")) if c]


def _add_derived(df, specs):
    """Compute each derived variable into `df`, with a flag of 0 where every component is measured.

    A component missing in a record leaves the sum missing there: a net radiation without one of
    its terms is not a smaller net radiation but none. A component with no quality flag counts as
    measured wherever it is present, the same rule the reader applies to a column without one.
    """
    for spec in specs.values():
        if "components" not in spec:
            continue
        total, measured = 0.0, True
        for sign, name, qc in spec["components"]:
            values = pd.to_numeric(df[name], errors="coerce")
            total = total + sign * values.mask(values <= MISSING + 1).astype(float)
            if qc:
                flag = pd.to_numeric(df[qc], errors="coerce")
                measured = measured & flag.isin(list(varreg.MEASURED_QC_CODES))
        df[spec["column"]] = total
        if spec.get("qc"):
            df[spec["qc"]] = np.where(measured, 0, 1)


def resolve(source, keys, label="the file"):
    """Turn whatever the caller asked for into `{key: {column, factor, qc}}`.

    Three forms are accepted, and the third is what makes this usable on series that were never
    near a FLUXNET file:

    - `None` - the registry's default variables the frame can supply, by their candidate names.
      The others (`Variable.default` is False) are taken only when named.
    - `["TA", "PREC"]` - these variables, resolved by candidate name as above.
    - `{"TA": "MY_TEMPERATURE", "PREC": {"column": "RAIN", "qc": "RAIN_FLAG", "factor": 1.0}}` -
      an explicit mapping from canonical key to column. The canonical key still has to be one the
      registry describes, because that is where the units, the thresholds and the aggregation come
      from; only the column name is the caller's to choose.

    A mapping that states no `factor` inherits the registry's own wherever the column it names is
    one of that key's candidates, so `{"NEE": "NEE_CUT_REF"}` reads in g C m-2 exactly as the
    unaided resolution of that file would. A column the registry does not list for the key has no
    factor to inherit and keeps 1.0, which is what a series named to a local convention needs. A
    `factor` the caller states always wins, including an explicit `1.0`.

    `source` is a path, a frame, or a list of column names - the resolution is a question about
    names, and answering it before the data is read is what lets the read be projected.
    """
    columns = set(columns_of(source))
    present = available(columns)
    if keys is None:
        # The default selection: what the file supplies of the variables a build takes unasked.
        # `available` still reports everything, which is how the rest are found and named.
        keys = [k for k in present if varreg.default(k)]
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
                recipe = varreg.VARIABLES[key].get("derived")
                raise KeyError(
                    f"{label} carries no column for {key}. Looked for: "
                    + ", ".join(n for n, _ in varreg.make(key).candidates)
                    + (", or all of its components: "
                       + "; ".join(" or ".join(names) for _, names in recipe["terms"])
                       if recipe else "")
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
        # The quality flag follows the column for the same reason the factor does, and leaving it
        # to default was the more damaging half of the same gap: naming the very column the
        # registry would have chosen dropped the flag beside it, and a flux read without its flag
        # counts every present record as measured. On the CH-Oe2 record that is 100 % against the
        # 42 % the file states, so no span is hatched, no sparse badge is awarded, and the build's
        # coverage warning falls silent on a record that is half gap-filled by design.
        #
        # `<column>_QC` is preferred so the flag stays with the variant it describes; an ordered
        # candidate list cannot do that once the caller has picked a column out of order.
        #
        # GPP and RECO carry no flag of their own: neither is measured, so both take the flag of
        # the NEE they were partitioned from, and the name of the column says which NEE that was.
        # Taking the first flag the list finds instead gave `GPP_NT_CUT_REF` the flag of
        # `NEE_VUT_REF` on any file carrying both u* selections - the gap-filling record of a
        # different threshold. On CH-Oe2 the two flags disagree on 1.1 % of records, which is small
        # there and need not be elsewhere. The list is the fallback for a column whose partner the
        # file does not carry.
        if "qc" not in spec:
            v_reg = varreg.make(key)
            candidates = v_reg.qc_candidates
            direct = f"{spec['column']}_QC"
            paired = _partitioned_from(spec["column"])
            # A flag named by the column's own FLUXNET name - `<column>_QC`, or for a partitioning
            # product the flag of the NEE it came from - describes that column exactly, whether or
            # not the registry lists it: `GPP_DT_VUT_25` is a real FULLSET column, and its flag is
            # `NEE_VUT_25_QC` by the file's own naming.
            #
            # The registry's ordered list is another matter, and is used only for a column the
            # registry itself lists, by the same rule as the factor below. Applied to a series
            # mapped in from another convention it paired that series with the gap-filling record
            # of a different column: `{"TA": {"column": "air_temp"}}` on a file that also carries
            # `TA_F_QC` took that flag and reported its measured share from it. Such a series
            # states its own flag with `--qc`, or has none and is measured wherever it is present.
            if direct in candidates and direct in columns:
                qc = direct
            elif paired and paired in columns:
                qc = paired
            elif spec["column"] in {name for name, _ in v_reg.candidates}:
                qc = next((q for q in candidates if q in columns), None)
            else:
                qc = None
        # The unit conversion follows the column, not the form the caller used to name it. Naming
        # one of the registry's own candidates - `--var NEE=NEE_CUT_REF`, to take the variant the
        # file carries rather than the one the registry prefers - is a choice of column and not a
        # choice of unit, so the factor the registry holds for that candidate is inherited. Without
        # that, a carbon flux named explicitly arrives in umol m-2 s-1 and fails `limits` with a
        # unit error the caller has no reason to expect, and is unreadable until the conversion is
        # restated by hand.
        #
        # A stated factor wins, and `1.0` stated is a statement: `spec.get("factor", 1.0)` cannot
        # tell it from silence, so the key is tested for instead.
        if "factor" in spec:
            factor = float(spec["factor"])
        else:
            candidates = dict(varreg.make(key).candidates)
            factor = float(candidates.get(spec["column"], 1.0))
        specs[key] = dict(column=spec["column"], factor=factor, qc=qc)
    return specs


def fill_levels(qc, series, convention, measured_codes=varreg.MEASURED_QC_CODES):
    """Each record's level in its flag's convention, as one `int8` per record.

    `0` is measured, `1..n` the convention's own levels in order, `n + 1` a record that has a value
    but a flag the convention does not document, and `-1` a record with no value, which no coverage
    figure counts. One byte a record, where a boolean per level would be four: on a twenty-one-year
    record that is 0.4 MB a variable against 1.5 MB.
    """
    codes = qc.to_numpy(dtype=float, na_value=np.nan)
    out = np.full(len(codes), len(convention.levels) + 1, dtype=np.int8)
    for i, level in enumerate(convention.levels, start=1):
        # A level with no codes of its own takes whatever flag is present and not measured, which
        # is all the unstated convention can say.
        hit = ~np.isnan(codes) if level.codes is None else np.isin(codes, level.codes)
        out[hit] = i
    out[np.isin(codes, list(measured_codes))] = 0
    out[series.isna().to_numpy()] = -1
    return pd.Series(out, index=series.index, name=series.name)


def read_fluxnet(path, keys=None, *, first_year=None, last_year=None, quiet=False):
    """Read the selected variables out of one half-hourly FLUXNET file.

    `keys` is the selection the whole atlas is built for, in any of the forms `resolve` accepts: a
    list of canonical keys, an explicit `{key: column}` mapping for series whose columns are named
    to some other convention, or `None` for every registry variable the file can supply - which is
    a convenience for exploring a new file rather than the normal way to call this.

    Returns the mapping the builder consumes: `{key: {v, df, series, measured, fill}}`, where
    `fill` is `fill_levels` of the quality flag, or `None` for a variable read without one.
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
        for col in _source_columns(spec):
            if col not in needed:
                needed.append(col)

    # The uncertainty columns are resolved the same way and against the same header, so they cost
    # one more pass over a list of names rather than another read of the file.
    #
    # Resolved for the column the variable was actually read from, not for the variable in general.
    # `NEE_VUT_REF_RANDUNC` is the uncertainty of `NEE_VUT_REF` and describes no other u* selection,
    # so a caller who named `NEE_CUT_REF` with `--var` gets that column's interval or none rather
    # than the default variant's. A column the registry knows no uncertainty for - one mapped in
    # from another convention among them - gets none, which is where this used to invent an error
    # bar for data it does not describe.
    unc = {}
    for key in keys:
        unc[key] = varreg.uncertainty(key, header, specs[key]["column"])
        for component in unc[key]:
            for col in component["columns"]:
                if col not in needed:
                    needed.append(col)

    df = _read_frame(path, usecols=needed)
    _add_derived(df, specs)

    # Half-hourly is what this reads, and a file on any other spacing lands on the half-hourly grid
    # rather than missing it. An hourly file fills every second slot, so reindexed onto 30 minutes
    # it comes out half missing with every coverage figure on the page halved and nothing to say
    # why. A file finer than half-hourly is worse, because it does not even look wrong: flooring
    # puts each of its records inside a window and the duplicates are dropped, so a ten-minute
    # record reads as a complete half-hourly one built from every third value.
    #
    # So the spacing is measured on the stamps the file states, before they are floored - after
    # that the two cases are indistinguishable. Distinct stamps only, so duplicated rows do not
    # make zero the commonest step; and the mode rather than the mean, because a record with
    # genuine gaps still has 30 minutes as its commonest step.
    # Parsed once and used twice: for the spacing here, and floored into the index below.
    stamps, on_grid = _raw_stamps(df, label=path.name)

    # A row without a timestamp cannot be placed on the grid, and a file saved from a spreadsheet
    # routinely ends in one, a row of empty fields. Dropped and counted, as an incomplete year is,
    # rather than failing a read that has nothing else wrong with it. Done before the spacing is
    # measured, which an undated row would otherwise enter as a missing step.
    undated = np.asarray(stamps.isna())
    if len(undated) and undated.all():
        raise ValueError(f"{path.name}: none of its {len(undated):,} rows carries a timestamp")
    if undated.any():
        df, stamps = df[~undated], stamps[~undated]
        if not quiet:
            say(f"  row(s) without a timestamp dropped: {int(undated.sum()):,}")

    if len(stamps) > 1:
        steps = pd.Series(stamps.drop_duplicates().sort_values()).diff().dropna()
        common = steps.mode()
        if len(common) and common.iloc[0] != pd.Timedelta(FREQ):
            raise ValueError(
                f"{path.name}: its records are {common.iloc[0]} apart, and this reads half-hourly "
                f"records. Resample to 30 minutes first, or see the documentation on input that is "
                f"not half-hourly.")

    index = _window_starts(stamps, on_grid)
    df = df.set_index(pd.DatetimeIndex(index))
    df = df[~df.index.duplicated(keep="first")].sort_index()

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
        v.derived = "components" in spec
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
        #
        # Where there is a flag, what it says about the rest is kept as well: one small integer per
        # record naming its level in the flag's convention, rather than a boolean per level. The
        # measured split is read off the same array, so the two cannot disagree.
        fill = None
        if v.qc_column and v.qc_column in df.columns:
            qc = pd.to_numeric(df[v.qc_column], errors="coerce")
            v.qc_convention = varreg.qc_convention(v.qc_column)
            fill = fill_levels(qc, series, v.qc_convention, v.measured_codes)
            v.fill_levels = [lv.label for lv in v.qc_convention.levels]
            if (fill == len(v.fill_levels) + 1).any():
                v.fill_levels.append(varreg.FILL_OTHER)
            measured = fill == 0
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

        out[key] = dict(v=v, df=df, series=series, measured=measured, fill=fill,
                        uncertainty=components)
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
