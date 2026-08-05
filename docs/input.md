# Reading the input

The input is one half-hourly file, `.csv` or `.parquet`, holding the FLUXNET-standardized record of
one site. {func}`fluxatlas.io.read_fluxnet` turns it into two things per selected variable: a
continuous 30-minute series in the canonical unit, and a boolean saying which records are measured
rather than modelled. Everything downstream works from those two and never touches the file again.

## What the reader decides

**The timestamp.** FLUXNET stores `TIMESTAMP_START` and `TIMESTAMP_END` as `YYYYMMDDHHMM`, and the
index is the start, which the file already holds. A 30-minute window falls inside one day, one month
and one hour whichever end of it is named, so nothing computed depends on the choice.

The end stamp is the exception, and the reason it is never used as it stands: a window ending at
`00:00` belongs to the previous day, so taking that stamp at face value moves a day's last half-hour
into the next day. A file carrying only `TIMESTAMP_END` has one window subtracted from it, and a
frame arriving on its own `DatetimeIndex` is floored onto the window, which maps a start-stamped and
a middle-stamped file onto the same index.

**Missing values.** `-9999` is FLUXNET's missing value and becomes `NaN` before anything is
computed.

**Whole years.** The grid is a whole number of years, and coverage denominators are the half-hours
a month should hold. A partial first or last year is therefore dropped rather than averaged in, and
the reader reports what it dropped. `first_year` and `last_year` narrow the record further.

**Units.** Each candidate column carries the factor onto the canonical unit, and each variable's
`limits` are checked after conversion. A wrong factor then fails the read and names the column,
instead of producing an atlas whose thresholds all read the same way.

```{admonition} Nothing is filtered, clipped or dropped
:class: important

The file is used as it is. `limits` is an assertion, not a filter: if every value falls inside the
bounds the read carries on and the series is exactly the column times its factor, and if any value
falls outside them the read **stops with an error**. There is no third outcome in which a value is
removed or altered.

The bounds exist to catch a wrong unit, so they are set far outside anything an ecosystem
produces rather than around what one usually does. Nighttime partitioning returns negative GPP,
and that is a real value that belongs in the record: it is read, summed into its month, and
coloured on the grid like any other.
```

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

A FULLSET file is wide and long, and an atlas of six variables needs about twenty of its couple of
hundred columns. So the header is read first, the selection is resolved against the column names
alone, and only then is the file read for the columns that survived.

On a record of several hundred megabytes that is the difference between a second and half a minute,
and between tens and hundreds of megabytes held. The bytes stream off disk either way; what the
projection removes is the tokenizing, converting and allocating of the columns nothing asked for.
The read then costs much the same whether one variable is selected or all of them.

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
