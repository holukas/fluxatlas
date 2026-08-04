# fluxatlas

Interactive explorer for FLUXNET-standardized ecosystem data.

`fluxatlas` builds a standalone, browsable page from the half-hourly
FLUXNET-standardized output of an eddy covariance site — every month of the
record on one grid, drilling down to the season, the month and the single day.

> **In preparation.** The library builds atlases for meteorological variables.
> The fluxes, a command-line interface and a desktop GUI are not written yet, and
> nothing beyond the 0.0.1 placeholder is on PyPI.

## Use

```python
import fluxatlas as fa

# What can this file supply?
fa.available("CH-LAE_HH_2016-2025.csv")
# {'TA': {'column': 'TA_EP', 'factor': 1.0, 'qc': None, 'units': '°C', ...}, ...}

# An atlas of air temperature and nothing else
fa.build_atlas("CH-LAE_HH_2016-2025.csv", "atlas.html", variables=["TA"])

# Several variables, and the payload kept for inspection
atlas = fa.Atlas("CH-LAE_HH_2016-2025.csv", ["TA", "PREC", "VPD"], site="CH-LAE")
atlas.metrics          # what the grid can be coloured by, for this selection
atlas.badges           # badge key -> how many months earned it
atlas.write("atlas.html")
```

The output is one self-contained HTML file that works offline.

## The selection decides the atlas

The variables passed in are the whole build. A metric whose variable is absent
is not offered, a badge whose inputs are missing is withheld with the reason
attached rather than silently skipped, a threshold-day test that reads an absent
variable is dropped, and the cross-variable composite is withheld rather than
computed over too few axes. An atlas of one variable is a smaller page, not a
broken one.

## Reading the input

The reader accepts what "FLUXNET-standardized" means in practice: FLUXNET2015 /
ONEFlux FULLSET names (`TA_F` with `TA_F_QC`), EddyPro's own FLUXNET output
(`TA_EP`), and position-indexed biomet columns (`TA_1_1_1`). Each canonical
variable lists the columns that can supply it, in preference order, with the
factor that converts them onto the canonical unit — vapour pressure deficit is
hPa in FULLSET and Pa in EddyPro output, and both become kPa.

`-9999` becomes missing before anything is computed, the index is the middle of
the averaging window so no record lands on the wrong day, and partial first and
last years are dropped because the grid is a whole number of years.

Where a `_QC` column exists, 0 means measured and anything above it is modelled;
that split drives every coverage rule on the page. A file without QC columns is
read as measured wherever it is not missing, which is the most that can be
concluded from it.

## Any half-hourly series, not only FLUXNET files

The candidate column names are a convenience. A file whose columns were named to
some other convention is read by naming them:

```python
fa.Atlas("local_record.parquet", {
    "TA":   {"column": "Lufttemperatur", "qc": "TA_FLAG"},
    "PREC": {"column": "Niederschlag"},
    "VPD":  {"column": "vpd_pascal", "factor": 0.001},   # into kPa
})
```

The canonical key still has to be one the registry describes — that is where the
units, thresholds and aggregation come from — but the column is yours to choose.

## Variables

Currently `TA`, `PREC`, `SW_IN`, `VPD`, `RH`, `SWC`. Fluxes follow.

## Example

`examples/` holds a twenty-one-year six-variable extract of the CH-LAE meteo
record and a script that builds two atlases from it:

```bash
uv run python examples/build_lae_meteo_atlas.py --open
```

It builds one atlas of all six variables and one of air temperature alone — 20
metrics against 7, 37 badge types against 16 — which is the selection behaviour
in one run.

## Tests

```bash
uv run pytest
```

Most tests run on synthetic data generated in `tests/conftest.py`, so the suite
passes without the example extract. The tests that read it skip when it is
absent.

## Origin

The page is the site-independent generalization of the calendar explorer built
for the [CH-LAE flux product](https://github.com/holukas/dataset_ch-lae_flux_product).

## License

GPL-3.0
