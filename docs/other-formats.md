# Files that are not FLUXNET-standardized

**Yes, this works, and it is the normal case.** Most real files are named to a local convention.
The registry's candidate column names are a convenience for files that happen to use FLUXNET names;
everything else is read by naming the columns yourself.

What the reader will not do is invent a variable. The canonical key has to be one the registry
describes, because that is where the unit, the plausible range, the aggregation and the thresholds
come from. The column behind it is yours.

```python
import fluxatlas as fa

fa.Atlas("my_tower.parquet", {
    "TA":   {"column": "Lufttemperatur", "qc": "TA_FLAG"},
    "PREC": {"column": "Niederschlag"},
    "VPD":  {"column": "vpd_pascal", "factor": 0.001},   # Pa into the canonical kPa
})
```

## What the file has to satisfy

Five things, and only the first two are hard to change after the fact.

**1. Half-hourly records.** Everything assumes a 30-minute averaging window: the reader builds a
`30min` index and coverage denominators are `n_days * 48`. Hourly or daily input is
[planned, not present](development.md#what-is-planned).

**2. A timestamp the reader can build an index from.** Four forms work:

| What the file carries | What is used |
| --- | --- |
| `TIMESTAMP_START` and `TIMESTAMP_END` | the midpoint of the two |
| `TIMESTAMP_START` alone | the stamp plus 15 minutes |
| `TIMESTAMP_END` alone | the stamp minus 15 minutes |
| `TIMESTAMP` | taken as it is |
| a parquet file already on a `DatetimeIndex` | taken as it is |

The stamp columns are parsed as the integer `YYYYMMDDHHMM` that FLUXNET writes. An ISO string
column such as `2016-01-01 00:15` will not parse: convert it, or write the file as parquet with a
`DatetimeIndex` instead. See [below](#the-timestamp-is-the-thing-that-usually-bites).

**3. One column per variable, numeric.** Text is coerced to numbers and anything that fails becomes
missing.

**4. Missing recorded as `-9999` or as empty.** Anything at or below `-9998` is read as missing,
which is the FLUXNET convention. A file that uses some other sentinel, `-999` say, has to be
converted first, or the sentinel will be averaged in as a value.

**5. Whole years.** The grid is a whole number of years, so a partial first or last year is dropped
and the reader says which.

## The three fields of a mapping

```python
{"TA": {"column": "Lufttemperatur", "qc": "TA_FLAG", "factor": 1.0}}
```

`column`
: The column to read. The only required field. A bare string is shorthand for it:
  `{"TA": "Lufttemperatur"}`.

`qc`
: The quality flag beside it, in the FLUXNET convention: **0 measured, anything above 0 modelled**.
  Optional. Without it, a record counts as measured wherever it is present, which is the most that
  can be concluded from a file that does not say. If your flag runs the other way, invert it before
  reading.

`factor`
: What the column is multiplied by to reach the canonical unit. The unit each variable expects is on
  the [variables](variables.md) page, and `fluxatlas --list` prints it.

The forms combine, so a file where some columns follow FLUXNET names and some do not is read in one
call:

```python
fa.Atlas("mixed.csv", {
    "TA": None,                                  # let the registry find it
    "SWC": {"column": "soil_moisture_10cm"},     # name this one
})
```

On the command line the same thing is `--vars TA --var SWC=soil_moisture_10cm`.

## A worked example

A local half-hourly product, comma-separated, with an ISO timestamp, its own names, a
fill flag that is 1 where the value was gap-filled, VPD in Pa, and `-999` for missing:

```text
datetime,           air_temp, rain_mm, vpd_pa, temp_filled
2016-01-01 00:00,        2.14,     0.0,  180.0,           0
2016-01-01 00:30,        2.02,     0.2,  175.0,           1
```

Three of those need converting, so the file is prepared once with pandas and read from memory:

```python
import pandas as pd
import fluxatlas as fa

df = pd.read_csv("tower_2016_2024.csv", parse_dates=["datetime"], index_col="datetime")

# 1. The index is the middle of the averaging window, and this file is stamped at the start.
df.index = df.index + pd.Timedelta("15min")
df.index.name = "TIMESTAMP_MIDDLE"

# 2. This file's sentinel is not FLUXNET's.
df = df.replace(-999, pd.NA)

# 3. The flag runs the other way: 1 means filled, and the reader wants 0 to mean measured.
df["temp_qc"] = df["temp_filled"]

df.to_parquet("tower.parquet")

fa.build_atlas("tower.parquet", "atlas.html", variables={
    "TA":   {"column": "air_temp", "qc": "temp_qc"},
    "PREC": {"column": "rain_mm"},
    "VPD":  {"column": "vpd_pa", "factor": 0.001},
})
```

Point 3 is worth reading twice: the flag is used as it is, and `0` is the only code that counts as
measured. A flag where `1` means good will report the record as entirely modelled, and every span
will carry the sparse badge.

## The timestamp is the thing that usually bites

A parquet file that arrives on a `DatetimeIndex` is **taken at its word**. The reader does not guess
whether the stamps are the start, the middle or the end of the averaging window, because a wrong
guess moves data between days silently.

The index it builds runs `00:15, 00:45, 01:15, …`, the middle of each half-hour. An index stamped at
`00:00, 00:30` therefore lands nowhere on it, and the read stops with the reason:

```text
tower.parquet: none of its 368,160 timestamps land on the half-hourly grid this reader builds,
which runs 00:15, 00:45, 01:15 and so on. The first stamp is 2016-01-01 00:00, so the index is
the start or the end of each averaging window rather than its middle. Shift it by half a window
before reading, e.g. df.index = df.index + pd.Timedelta('15min') for a start-stamped file.
```

The fix is the one the message states. If instead your file carries FLUXNET's integer
`TIMESTAMP_START` and `TIMESTAMP_END` columns, nothing needs doing: the reader takes their midpoint.

## What you give up

Two things, and both are consequences of the file not being a FULLSET one rather than of the
mapping.

**No uncertainty interval.** Uncertainty columns are attached only where the variable came from a
column the registry knows, so a mapped column carries none. `NEE_VUT_REF_RANDUNC` is the uncertainty
of `NEE_VUT_REF`; attaching it to a series mapped in from elsewhere would be inventing an error bar
for data it does not describe. Pages built this way state a figure without a `±`, which is the
honest outcome.

**No measured share without a flag.** Every span is then reported as fully measured, so the coverage
warnings on the page say nothing. The statistics are unaffected, since they are
[gated on availability](coverage.md) rather than on the measured share.

## A variable the registry does not describe

`fa.known_variables()` lists the eleven canonical keys. There is no mapping onto a twelfth, because
the key is what carries the unit, the limits, the aggregation, the ramps and the day tests.

Adding one is a change to `fluxatlas/variables.py` rather than a call-site option: add an entry with
its candidate columns, canonical unit, plausible limits and aggregation. It will then be read, shown
in the day panel and counted in coverage. To be colourable on the grid it also needs a metric in
`build.METRICS`, and to earn badges it needs rules in `build.BADGES`. Neither is required. See
[adding a variable](variables.md#adding-a-variable), and check a build of that variable alone in a
browser afterwards.

## Checking before you commit to it

```python
import fluxatlas as fa

fa.available("tower.parquet")     # what the registry finds unaided, usually nothing here
```

An empty answer is not an error, it is the expected result for a file with its own names. Build one
variable first:

```python
atlas = fa.Atlas("tower.parquet", {"TA": {"column": "air_temp", "qc": "temp_qc"}})
atlas.report()
```

The read prints the column, the flag, the record count and the measured share per variable, which is
where a wrong flag or a missing sentinel shows up immediately. A wrong `factor` does not get that
far: each variable's plausible range is checked after conversion, so a unit error fails the read
naming the column.
