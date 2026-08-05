# Reading the input

The input is one half-hourly file, `.csv` or `.parquet`, holding the FLUXNET-standardized record of
one site. {func}`fluxatlas.io.read_fluxnet` turns it into two things per selected variable: a
continuous 30-minute series in the canonical unit, and a boolean saying which records are measured
rather than modelled. Everything downstream works from those two and never touches the file again.

## What the reader decides

**The timestamp.** FLUXNET stores `TIMESTAMP_START` and `TIMESTAMP_END` as `YYYYMMDDHHMM`. The
index used is the middle of the averaging window, which puts an averaged value at the centre of the
interval it was averaged over. A start stamp would serve the calendar equally well, since a
30-minute window never crosses midnight from its start. The end stamp is the one that does not: an
end stamp of `00:00` belongs to the previous day, and a reader that takes it at face value moves a
day's last half-hour into the next day. A file carrying only one of the two stamps is shifted half
a window onto the middle, and a frame that already arrives on a `DatetimeIndex` is taken as it is.

**Missing values.** `-9999` is FLUXNET's missing value and becomes `NaN` before anything is
computed. Left in place it would give a mean air temperature of several thousand below zero.

**Whole years.** The grid is a whole number of years, and coverage denominators are the half-hours
a month should hold. A partial first or last year is therefore dropped rather than averaged in, and
the reader reports what it dropped. `first_year` and `last_year` narrow the record further.

**Units.** Each candidate column carries the factor onto the canonical unit, and each variable's
`limits` are checked after conversion. A wrong factor then fails the read and names the column,
instead of producing an atlas whose thresholds all read the same way.

`limits` are a unit check, not a quality check, so they sit well outside the observed span.
Nighttime partitioning does return negative GPP (-49 µmol m⁻² s⁻¹ on the CH-Oe2 record), and
half-hourly `LE_F_MDS` and `H_F_MDS` reach ±1000 W m⁻².

## What counts as FLUXNET-standardized

In practice, more than one convention. The reader takes all of them:

- FLUXNET2015 and ONEFlux FULLSET names, such as `TA_F` with `TA_F_QC` beside it;
- EddyPro's own FLUXNET output, such as `TA_EP`, often with no QC column;
- position-indexed biomet columns, such as `TA_1_1_1`.

All three are air temperature. So each canonical variable lists the columns that can supply it, in
preference order, each with its own factor. Vapour pressure deficit is hPa in FULLSET and Pa in
EddyPro output, and both become kPa. The [variables](variables.md) page has the full list.

Where a `_QC` column exists, 0 means measured and anything above it means modelled. That split
drives every coverage rule on the page. A file without QC columns is read as measured wherever it
is not missing, which is as much as can be concluded from it.

## The file is read twice, and the header comes first

A FULLSET file is wide and long. The CH-Oe2 record is 248 columns over twenty-one years of
half-hours, 552 MB, and an atlas of six variables needs about twenty of those columns. So the
header is read first, the selection is resolved against the column names alone, and only then is
the file read for the columns that survived.

| The CSV read step | Time | Memory |
| --- | --- | --- |
| Header only | 0.18 s | |
| The selected columns | **0.61 s** | **59 MB** |
| All 248 columns | 21.07 s | 697 MB |

The bytes stream off disk either way. What the projection removes is the tokenizing, converting and
allocating of the 228 columns nothing asked for. End to end, including resolution, timestamps,
reindexing onto the 30-minute grid, unit conversion and the measured split, `read_fluxnet` on that
file takes about 2.6 s, whether one variable is selected or all eleven.

This has a consequence for anyone extending the package. {func}`fluxatlas.io.available` and
{func}`fluxatlas.io.resolve` take column names, not data, so nothing that needs to look at values
can live in them.

```{admonition} The column that is present but empty
:class: note

`LE_CORR` and `H_CORR` are `-9999` in every record of a real FULLSET file. They resolve like real
columns, because a header scan cannot see that they were never filled. `read_fluxnet` catches that
after the read and refuses them, naming the alternatives, so neither becomes a variable with an
empty grid.
```

## Naming the columns yourself

The candidate names are a convenience, not a requirement. {func}`fluxatlas.io.resolve` takes three
forms, and the third is what makes the package usable on series that were never near a FLUXNET
file:

```python
None                                   # every registry variable the file can supply
["TA", "PREC"]                         # these variables, resolved by candidate name
{"TA": "MY_TEMPERATURE",               # an explicit mapping from canonical key to column
 "PREC": {"column": "RAIN", "qc": "RAIN_FLAG", "factor": 1.0}}
```

The canonical key still has to be one the registry describes, since that is where the units, the
thresholds and the aggregation come from. Only the column name is yours to choose. A key the
registry does not know raises an error listing the keys it does.

[Files that are not FLUXNET-standardized](other-formats.md) works this through: what a file has to
satisfy, the three fields of a mapping, a worked conversion, and the two things a mapped column
gives up.

## Input that is not half-hourly

Everything assumes 30-minute records: the reader reindexes onto a `30min` grid, and seasonal
coverage denominators are `n_days * 48`. Hourly or daily input needs those two places generalized
first, or coverage will be wrong. See [what is planned](development.md#what-is-planned).
