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

## One file for a whole build

A site with many variables is easier to describe in one settings file than on a command line. The
file is JSON, or YAML where PyYAML is installed, and holds everything `Atlas` takes: the input and
the output, the site, the years, the seasons, the variables with every setting on this page,
`primary`, the site's position and the reference station.

```json
{
  "input": "data/site_30min.parquet",
  "output": "pages/site_atlas.html",
  "site": "XX-Abc",
  "site_long": "Example site, mixed forest",
  "first_year": 2005,
  "last_year": 2024,
  "seasons": "DJF",
  "hourly": true,
  "title": "XX-Abc meteorology",
  "lat": 47.48,
  "lon": 8.36,
  "utc_offset": 1,
  "primary": {"SWC": "SWC@0.1"},
  "reference": {
    "file": "data/station_30min.parquet",
    "station": "Station",
    "distance_km": 2.5,
    "elevation_m": 845,
    "shift": -15
  },
  "variables": {
    "TA": {
      "column": "TA_HOM",
      "qc": "TA_FLAG",
      "raw": "TA_RAW",
      "qc_legend": {
        "0": ["measured", "measured"],
        "1": ["XGBoost model", "XGBoost"],
        "4": ["linear interpolation (short gap)", "interpolated"]
      },
      "source": {
        "column": "TA_SOURCE",
        "legend": {"0": ["CS215 probe", "CS215"], "1": ["MP101A probe", "MP101A"]},
        "reference_code": 0
      },
      "reference": {"column": "TA_STATION", "split": true},
      "notes": ["Measured at 47 m."],
      "correction_note": "The earlier era is raised by {offset} before {break_ts}."
    },
    "PREC": "RAIN_TOT",
    "VPD": {"column": "VPD_PA", "factor": 0.001},
    "TS@0.1": {
      "column": "TS_10",
      "qc": "TS_10_METHOD",
      "measured_codes": [1, 2],
      "title": "Soil temperature at 0.1 m",
      "short": "Soil temperature 0.1 m"
    },
    "SWC@0.1": {"column": "SWC_10"},
    "SWC@0.3": {"column": "SWC_30"}
  }
}
```

```bash
fluxatlas --config site.json
```

```python
atlas = fa.Atlas.from_config("site.json")
atlas.write()                         # to the output the file names
fa.read_config("site.json")           # the keyword arguments of build_atlas, checked
```

Every key is optional. `variables` is a list of canonical keys or a mapping, and in the mapping
each variable is given by its column name alone, by null to leave the column to the registry, or by
an entry with `column`, `qc`, `factor` and the settings described below. A legend is written as in
a `--legends` file, each code as a string mapped to `[long, short]`. A key whose value is null is
treated as absent, except `qc`, where null states that the series has no flag. `quiet` is not a
setting of the file; it is a flag of the command line and a keyword of `from_config`.

**A relative path is taken from the settings file's own folder,** not from the working directory.
That holds for `input`, `output` and the reference station's `file`, so a settings file and the
data beside it can be moved together and built from anywhere.

**The file is checked in full before any data file is opened.** A key the file does not know is
refused at every level, with the key and its place in the file:
`site.json, variables.TA.source: unknown key(s) 'legnd'; it takes column, legend, reference_code`.
A value of the wrong kind is refused in the same way. The checks of the settings themselves -
`primary`, the reference station, the columns and the legend codes - then run as they do for a
mapping passed from Python.

**`checks` cannot be stated in a file**, because it is a Python callable, and a file that names it
is refused. Add it in Python to the variables the file gives:

```python
variables = fa.read_config("site.json")["variables"]
variables["TA"]["checks"] = shape_of_the_correction
atlas = fa.Atlas.from_config("site.json", variables=variables)
```

### What overrides the file

On the command line, a flag also given overrides the file:

- a value - the input, `-o`, `--site`, `--site-long`, `--first-year`, `--last-year`,
  `--seasons`, `--no-hourly`, `--title`, `--lat`, `--lon`, `--utc-offset` - replaces the file's;
- a flag that names a variable replaces that field of the variable's entry and keeps the rest.
  `--var KEY=COLUMN` replaces the column, and with it the flag and the factor that described the
  file's column, so give `--qc` and `--factor` again where they apply. `--source` and `--ref` name a
  new column and replace that whole setting, legend and split included. `--note` replaces the
  variable's notes, and `--legends` the legends it gives;
- `--vars` adds variables to the file's selection;
- `--primary` replaces the entries it names and keeps the others;
- `--reference` replaces the station's file, and `--ref-station`, `--ref-distance`,
  `--ref-elevation` and `--ref-shift` the fields they name.

In Python, `Atlas.from_config(path, **overrides)` takes the keywords of `build_atlas` - `path` for
the input, `out` for the output - and an override replaces the file's value for that keyword
whole: `variables={"TA": "TA_F"}` replaces the file's mapping rather than being merged into it.

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
on the grid. A depth installed part way through the record shows the years before it as missing. It has to name its column. It carries no day tests of its own, and it does not mark a
span sparse, since it is a further series of a variable the page already describes.

The plain key keeps its meaning. `primary={"SWC": "SWC@0.2"}` reads that instance under the plain
key, so the composite, the badges and the grid's soil water metric use it; its page says it stands
in for the others. Without `primary`, the plain key is what the registry finds in the file, or
absent.

`title` and `short` name a variable, which is most useful for an instance:
`title="Soil water content at 0.2 m"`.

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
may raise, which stops the build naming the variable. No site check ships with the package. It is
the one setting a settings file cannot state.

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
a quarter of an hour, and flooring onto the window makes -15 and -30 land alike. The station's values
are compared as its file states them and are never converted, so a reference column has to be in
the variable's unit already.

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

## Provenance

The settings used in a build are stored in `meta.provenance` of the payload, which
`Atlas.provenance` returns, and are listed in the footer of the page. They are stored next to the
column, quality flag and factor of each variable:

| setting | field |
| --- | --- |
| `source` | `columns[key].source`, the flag column, with `source_legend` and `source_reference_code` where given |
| `raw` | `columns[key].raw` |
| `qc_legend` | `columns[key].qc_legend` |
| `measured_codes` | `columns[key].measured_codes`, where it is not 0 alone and the variable has a fill flag |
| `primary` | `primary` |
| `lat`, `lon`, `utc_offset` | `lat`, `lon`, `utc_offset` |
| `reference` | `reference`: the station file's name, size in bytes and SHA-256 digest, the station, its `shift`, `distance_km` and `elevation_m` where given, and per compared variable its `column`, `split` and `shift` |

A legend is stored as a mapping from each code, as a string, to its long and short label. The size
and SHA-256 digest of the reference station file are computed in the same way as for the input
file, because a station series can be reissued under an unchanged file name. A field is present
only if the build used the corresponding setting. A build without site settings therefore has the
same provenance as before.

## An example

`examples/ch-lae_site.json` describes the merged CH-LAE meteo product with every setting on this
page except `checks`: thirteen products, five soil water depths, seven soil temperature depths, the
corrected air temperature, precipitation and soil water with their twins, the instrument flags and
the MeteoSwiss Lägeren station for air temperature and humidity. `fluxatlas --config
examples/ch-lae_site.json` builds it, and `examples/build_lae_meteo_atlas.py` reads the same file
and builds the same page. The legends and notes are in the settings file, not in the package.
