# Getting started

The steps are the same from either front end. Ask the file what it carries, choose what the atlas
is for, build it.

## 1. Ask the file what it carries

```bash
fluxatlas EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv --list
```

```text
EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv
  variable  column                 quality flag           unit
  TA        TA_F                   TA_F_QC                °C
  PREC      P_F                    P_F_QC                 mm
  SW_IN     SW_IN_F                SW_IN_F_QC             W m⁻²
  VPD       VPD_F                  VPD_F_QC               kPa  (x0.1)
  ...
```

`--list` reads the header and nothing else, so it answers in well under a second even on a 552 MB
FULLSET file. For each canonical variable it names the column it would be read from, the quality
flag beside it, the canonical unit, and the factor that converts onto it. Variables the registry
could not find are listed under the table, with the flag that names a column by hand.

The library gives the same answer. This is what a variable picker would be built on:

```python
import fluxatlas as fa

fa.available("record.csv")
# {'TA': {'column': 'TA_F', 'factor': 1.0, 'qc': 'TA_F_QC', 'units': '°C',
#         'title': 'Air temperature'}, ...}
```

## 2. Build an atlas

```bash
fluxatlas record.csv -o atlas.html --vars TA,PREC,NEE,GPP
```

Leaving out `--vars` builds every registry variable the file can supply. That is useful for looking
at an unfamiliar file, but a chosen selection gives a page that answers a question. See
[selection](selection.md).

The build reports what it found. This is the six-variable run on the CH-LAE extract that ships in
`examples/`, cut down for length:

```text
reading CH-LAE_meteo_30min_2005-2025.parquet: 6 variable(s), 2005-2025
  TA      TA_T1_47_1_HOMOGENIZED_gfXG FLAG_TA_T1_47_1_ISFILLED  368,160 records   98.9 % measured
  ...
building 252 months, 2005-2025 ...
  warning: SW_IN is under 50 % measured in 10 of 252 months (lowest 0 % in January 2005); the
  gap-filled values are used and those months are marked on the grid
  badges awarded: Frost days 98, Ice days 79, Heavy rain day 55, In cloud 46, Colder than normal
  46, Tropical nights 45, Wet month 44, ...
  trend TA                 +0.760 °C/decade  p = 0.003, 21 years
  trend PREC total         +5.760 mm/decade  p = 0.923, 20 years
  trend SWC              withheld, 9 complete years
  written: examples\output\CH-LAE_atlas.html  (3.1 MB)
```

Coverage warnings come before the figures they qualify. The trends are printed because every
anomaly and rank on the page is taken against a whole-record normal, and a trend moves that normal.
[Coverage](coverage.md) sets out what the warning means.

## 3. The same from the library

```python
import fluxatlas as fa

# Read, build and write in one call.
fa.build_atlas("record.csv", "atlas.html", variables=["TA", "PREC", "VPD"])
```

Keeping the built object is worth it when more than one page comes out of one read, or when you are
still trying selections:

```python
atlas = fa.Atlas("record.csv", ["TA", "PREC", "VPD"], site="CH-LAE")

atlas.metrics       # [(key, label), ...] what the grid can be coloured by, for this selection
atlas.badges        # {badge key: how many months earned it}
atlas.first_year, atlas.last_year
atlas.payload       # everything the renderer is given

atlas.write("atlas.html")
atlas.write("//share/published/CH-LAE_atlas.html")   # nothing is recomputed
```

The payload is built once, on construction. That is the expensive step. `write` can then run as
often as you need.

## Files named to another convention

Most real files do not use FLUXNET names. Name the columns instead:

```python
fa.Atlas("local_record.parquet", {
    "TA":   {"column": "Lufttemperatur", "qc": "TA_FLAG"},
    "PREC": {"column": "Niederschlag"},
    "VPD":  {"column": "vpd_pascal", "factor": 0.001},   # into kPa
})
```

```bash
fluxatlas local_record.parquet -o atlas.html \
    --var TA=Lufttemperatur --qc TA=TA_FLAG \
    --var VPD=vpd_pascal --factor VPD=0.001
```

The canonical key still has to be one the registry describes, since that is where the units,
thresholds and aggregation come from. The column name is yours. Both forms combine, so
registry-found and hand-named variables can appear in one build. See
[reading the input](input.md#naming-the-columns-yourself).

## Working examples

`examples/` holds two scripts, and together they show what a selection does.

```bash
uv run python examples/build_lae_meteo_atlas.py --open
```

This builds two atlases from the committed twenty-one-year CH-LAE meteo extract: one of all six
variables, one of air temperature alone. The first offers 20 metrics and 37 badge types, the second
7 and 16. The extract keeps its CH-LAE column names, because naming columns by hand is the general
case.

```bash
uv run python examples/build_oe2_flux_atlas.py --open
uv run python examples/build_oe2_flux_atlas.py --input SOME_OTHER_FULLSET.csv --vars NEE,GPP,RECO
```

The other case: a real FLUXNET FULLSET record, whose columns the registry finds unaided, carrying
the fluxes. The script prints what the file can supply, then builds one page from all of it. Its
default input is 552 MB and is not committed. `--input` points it at any FLUXNET-standardized
half-hourly file, and `--out` writes outside the repository, which is worth doing: a page of that
record with the hourly layer is about 6 MB.
