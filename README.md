<h1>
  <img src="fluxatlas/assets/logo.svg" alt="" width="40" align="absmiddle">
  fluxatlas
</h1>

Interactive explorer for FLUXNET-standardized ecosystem data.

`fluxatlas` turns the half-hourly record of an eddy covariance site into one browsable
HTML page: every month of the record on one grid, opening down to the season, the year,
the month and the single day. Fluxes, meteorology and their quality flags.

The output is a single file. It carries its own scripts and styles, so it opens from a
memory stick with no server and no network.

> **In preparation.** The library and the command line work for meteorology and for the
> turbulent fluxes. There is no desktop GUI yet, and PyPI holds only the 0.0.1
> placeholder, so install from source.

**Documentation: [fluxatlas.readthedocs.io](https://fluxatlas.readthedocs.io)**

## Install

```bash
git clone https://github.com/holukas/fluxatlas.git
cd fluxatlas
uv sync
```

Python 3.12 or 3.13.

## Command line

```bash
fluxatlas record.csv --list
```

`--list` reports which variables can be read from the file, and which cannot. It reads
the header only, so it answers immediately even on a file of several hundred megabytes.

```bash
fluxatlas record.csv -o atlas.html --vars TA,PREC,NEE
```

Where the columns are named to some other convention, which is most real files, name
them:

```bash
fluxatlas record.parquet -o atlas.html --var TA=air_temp --qc TA=TA_ISFILLED
```

`--qc` names the quality flag beside a column (0 measured, above 0 modelled) and
`--factor` converts a column onto the canonical unit. Both forms combine in one call.

Seasons default to the four meteorological ones. Name the first and the rest follow:
`--seasons DJFMAM` gives two half-years, `--seasons none` drops the seasonal scale.

`python -m fluxatlas` is the same entry point. Every option is listed in the
[command-line reference](https://fluxatlas.readthedocs.io/en/latest/cli.html).

## Use as a library

```python
import fluxatlas as fa

fa.available("record.csv")                                    # what the file can supply
fa.build_atlas("record.csv", "atlas.html", variables=["TA"])  # TA and nothing else

atlas = fa.Atlas("record.csv", ["TA", "PREC", "NEE"], site="CH-LAE")
atlas.metrics        # what the grid can be coloured by, for this selection
atlas.badges         # badge key -> how many months earned it
atlas.write("atlas.html")
```

A file whose columns follow no convention the registry knows is read by naming them:

```python
fa.Atlas("local_record.parquet", {
    "TA":   {"column": "air_temp", "qc": "TA_FLAG"},
    "PREC": {"column": "rain_mm"},
    "VPD":  {"column": "vpd_pa", "factor": 0.001},   # into kPa
})
```

The file has to be half-hourly, carry a timestamp, and use `-9999` or empty for missing.
[Files that are not FLUXNET-standardized](https://fluxatlas.readthedocs.io/en/latest/other-formats.html)
works through a full conversion.

## Variables

| | |
| --- | --- |
| Meteorology | `TA`, `PREC`, `SW_IN`, `VPD`, `RH`, `SWC` |
| Carbon | `NEE`, `GPP`, `RECO` |
| Energy | `LE`, `H` |

The carbon fluxes are carried as totals in g C m⁻², so a tile reads as the carbon the
site gained or lost. `NEE` is signed by the micrometeorological convention, negative for
uptake, and the page writes the direction out beside every figure. Every flux figure
carries an uncertainty interval, with the components it covers named beside it.

## What the page shows

The grid draws at four resolutions: months, seasons, years, or every day of the record.
Each tile carries badges for what was remarkable about that span, and opens to a panel
of that span day by day, against the normal, and ranked among the others.

Each variable also has a page of its own: the slope of each calendar month taken
separately, every year of the record, the shape of the year, and how much of it was
measured.

**The variables you pass in are the whole build.** A metric whose variable is absent is
not offered, and a badge whose inputs are missing is withheld with the reason attached.
An atlas of one variable is a smaller page, not a broken one.

**Statistics use the gap-filled values, and the page says what they rest on.** Normals,
ranks, anomalies, badges and trends are computed wherever the product covers a span. How
much of it was measured never withholds a figure; it warns, and marks the span on the
grid.

## Examples

```bash
uv run python examples/build_lae_meteo_atlas.py --open
```

Builds two atlases from the twenty-one-year CH-LAE extract in `examples/data/`: one of
six variables and one of air temperature alone.

```bash
uv run python examples/build_oe2_flux_atlas.py --input YOUR_FULLSET.csv --open
```

The opposite case: a FLUXNET FULLSET record, whose columns are found without being told
anything, carrying the fluxes.

## Tests

```bash
uv run pytest
```

Most tests run on synthetic data, so the suite passes on a fresh checkout.

## Author

Lukas Hörtnagl, [Grassland Sciences group, ETH Zürich](https://gl.ethz.ch/)
([holukas@ethz.ch](mailto:holukas@ethz.ch)) ·
[github.com/holukas/fluxatlas](https://github.com/holukas/fluxatlas)

The page generalizes the calendar explorer built for the
[CH-LAE flux product](https://github.com/holukas/dataset_ch-lae_flux_product), which was
tied to one site.

## License

GPL-3.0
