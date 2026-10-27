# Site settings

A FLUXNET file needs none of this page. Its columns, its flags and their conventions are known to the
registry, and a list of keys is the whole of the configuration.

A site's own product usually says more than a FLUXNET file can. It may carry a second flag naming
the sensor behind each value, a fill flag whose codes follow no FLUXNET convention, one variable at
several depths, a corrected series beside the one the instrument reported, and a reference station
nearby. Each of those is a **setting** of a variable, given beside its column. Every setting is
optional, and a build that names none of them produces exactly the page it would have produced
before the settings existed.

None of the settings judges the record. A source flag, a correction and a reference station are
described as figures; nothing is screened, corrected or withheld because of them.

## Where the settings go

In Python, a setting is a field of the variable's entry in the mapping, beside `column`, `qc` and
`factor`. A mapping that gives settings and no `column` leaves the column to the registry:

```python
import fluxatlas as fa

fa.Atlas("site.parquet", {
    "TA": dict(column="TA_HOM", qc="TA_FLAG", raw="TA_RAW",
               qc_legend={1: ("XGBoost model", "XGBoost"), 4: ("interpolated", "interpolated")},
               source=dict(column="TA_SOURCE", reference_code=0,
                           legend={0: ("CS215 probe", "CS215"), 1: ("MP101A probe", "MP101A")}),
               reference=dict(column="TA_STATION", split=True),
               notes=["Measured at 47 m."]),
    "SWC@0.1": dict(column="SWC_10"),
    "SWC@0.3": dict(column="SWC_30"),
}, primary={"SWC": "SWC@0.1"}, lat=47.48, lon=8.36, utc_offset=1,
   reference=dict(file="station.parquet", station="Station", distance_km=2.5, elevation_m=845,
                  shift=-15))
```

On the command line each setting is a flag naming a variable that is already in the selection, by
`--vars` or `--var`. The legends are long, so they come from a file; see
[the command line](cli.md) for every flag.

```bash
fluxatlas site.parquet -o atlas.html --var TA=TA_HOM --qc TA=TA_FLAG --raw TA=TA_RAW \
    --source TA=TA_SOURCE --source-ref TA=0 --legends legends.json \
    --var SWC@0.1=SWC_10 --var SWC@0.3=SWC_30 --primary SWC=SWC@0.1
```

## A source flag

`source` names a second flag that says which sensor, record or calibration a value came from. It is
independent of the fill flag: a value can be measured by either of two probes, and filled by a model
in either era. The page states, for each year, the share of its records under each code, as a
stacked bar and a table, and each span panel states the share of that span beside its fill.

`source` is a column name, or a dict with `column`, an optional `legend` and an optional
`reference_code`. The **reference era** is the era a correction and a hardware change are measured
against: the first record carrying its code dates the change.

## A legend of the site's own

FLUXNET flags follow two conventions, which the page reads from the flag's name; see
[coverage](coverage.md). A site's flag follows its own, and `qc_legend` states it. A legend maps each
code to a long label, used in the legends of the coverage cards, and a short one, used where space
is tight:

```python
{1: ("XGBoost model", "XGBoost"), 4: ("linear interpolation (short gap)", "interpolated")}
```

A code may also map to a single string, or to `{"long": ..., "short": ...}`. In a JSON or YAML legend
file the codes are written as text and read as integers:

```json
{"TA": {"source": {"0": ["Campbell CS215 (from 21 Jan 2016)", "CS215"],
                   "1": ["Rotronic MP101A (to 31 Dec 2015)", "MP101A"]},
        "qc": {"1": ["XGBoost model", "XGBoost"]}}}
```

**Where a legend is given, every code the flag carries must have an entry.** A code the legend does
not describe stops the build and is named, because a legend is a claim about every record and the
page would otherwise label a record it knows nothing about. Only the years the build reads are
checked. Without a legend the FLUXNET conventions stand, and an undocumented code is reported as
filled without a documented flag.

`measured_codes` says which codes mean measured, where that is not 0 alone. A flag that also names
the sensor generation has more than one: a soil temperature whose METHOD flag codes the current and
the early profile 1 and 2 is `measured_codes=(1, 2)`. A legend's level is shown only where the record
carries it beside a value, so a code such as "no value" does not appear as a kind of fill.

## Several series of one variable

A site may measure one quantity at several depths or heights. Each is an **instance** of the
registry variable, addressed `BASE@LABEL`: `SWC@0.05`, `TS@0.15`, `TA@2m`. An instance takes
everything the registry says of its base - unit, limits, aggregation, digits, coverage thresholds and
description - and has its own column, flags, settings, page, entry in the variable index and metric
on the grid. It has to name its column. It carries no day tests of its own, and it does not mark a
span sparse, since it is a further series of a variable the page already describes.

The plain key keeps its meaning. `primary={"SWC": "SWC@0.2"}` reads that instance under the plain
key, so the composite, the badges and the grid's soil water metric use it; its page says it stands
in for the others. Without `primary`, the plain key is what the registry finds in the file, or
absent.

`title` and `short` name a variable, which is most useful for an instance:
`title="Soil water content at 0.2 m"`.

## A variable's own years

`first_year` and `last_year` read a variable over part of the record: a depth dug in 2020, a channel
that stopped in 2021. Outside its years the variable has no value and no coverage figure, rather
than a decade of zero coverage, and its trend, normals and record are taken over its own years.
They are clipped to the years the file covers completely; years outside those are refused.

## A corrected series and its twin

`raw` names the uncorrected twin of a homogenised series. The corrected series is the one the page
shows; the twin is read only to measure what the correction did, as the corrected series minus the
twin: how many records it changed, its range, mean and distinct values, the same per era of the
source flag with the constant where an era has one, and its mean, lowest and highest per year.

`correction_note` describes the correction on the page. Four placeholders are filled from the
figures on every build, so the text cannot drift from the file:

| placeholder | filled with |
| --- | --- |
| `{units}` | the variable's unit |
| `{break_ts}` | the first record of the reference era |
| `{offset}` | the single constant of every record before it, or "an era-wide offset" |
| `{shield_max}` | the largest negative change inside the reference era |

`checks` is a callable `checks(delta, source)` that a site passes to assert the shape of its own
correction: `delta` is the series of changes and `source` the source flag beside it, or None. It
may raise, which stops the build naming the variable. No site check ships with the package.

## A reference station

A station nearby, run by another institution, takes the weather out of a difference and leaves the
instruments. The station is a second half-hourly file:

```python
reference=dict(file="station.parquet", station="MeteoSwiss Lägeren", distance_km=2.5,
               elevation_m=845, shift=-15)
```

and each variable compared with it names its column: `reference=dict(column="TA_STATION",
split=True)`. `shift`, in minutes, moves the station's stamps before they are put on the half-hourly
windows; a station stamped at the end of its half-hour and a product stamped at the middle differ by
a quarter of an hour, and flooring onto the window makes -15 and -30 land alike. `factor` brings the
station's unit onto the variable's, 0.1 for pressure in hPa against a product in kPa.

Only measured records of the product are compared. At least 10,000 overlapping half-hours are
needed, and below that the comparison is withheld and the page says why. The page states the
correlation, the mean and the spread of the residual, the monthly residual with its 12-month
centred rolling median, and the residual of each year. `split=True` draws night and day apart, by
the elevation of the sun at the middle of each half-hour; it needs `lat`, `lon` and `utc_offset`,
the hours the file's clock is ahead of UTC. diive's potential radiation is used where diive is
installed, and the NOAA solar-position formula otherwise.

Where the variable has a source flag with a reference era, the residual is also compared across the
hardware change: the three years before the year of the first reference record against the three
after, that year left out, for all hours and for night and day.

## Notes

`notes` is a list of paragraphs about the variable, shown on its page below the summary; `{units}`
is filled in, and `<code>` is kept as code. They are the site's statements and the page presents
them as such. The registry's own description of a variable is unchanged by them.

## An example

`examples/build_lae_meteo_atlas.py` builds the merged CH-LAE meteo product with every setting on this
page: thirteen products, five soil water depths, seven soil temperature depths, the corrected air
temperature, precipitation and soil water with their twins, four instrument flags and the MeteoSwiss
Lägeren station. Its legends and notes are in the script, not in the package.
