<h1>
  <img src="https://raw.githubusercontent.com/holukas/fluxatlas/main/fluxatlas/assets/logo.svg" alt="" width="40" align="absmiddle">
  fluxatlas
</h1>

[![PyPI - Version](https://img.shields.io/pypi/v/fluxatlas?style=for-the-badge&color=%23EF6C00)](https://pypi.org/project/fluxatlas/)
[![Documentation](https://img.shields.io/readthedocs/fluxatlas/stable?style=for-the-badge)](https://fluxatlas.readthedocs.io/en/stable/)
[![Tests](https://img.shields.io/github/actions/workflow/status/holukas/fluxatlas/tests.yml?branch=main&style=for-the-badge&label=tests)](https://github.com/holukas/fluxatlas/actions/workflows/tests.yml)
[![License](https://img.shields.io/github/license/holukas/fluxatlas?style=for-the-badge&color=%237CB342)](https://github.com/holukas/fluxatlas/blob/main/LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21815054.svg)](https://doi.org/10.5281/zenodo.21815054)

Interactive explorer for FLUXNET-standardized ecosystem data.

`fluxatlas` turns the half-hourly record of an eddy covariance site into one browsable
HTML page: every month of the record on one grid, opening down to the season, the year,
the month and the single day. Fluxes, meteorology and their quality flags.

The output is a single file. It carries its own scripts and styles, so it opens from a
memory stick with no server and no network.

The library and the command line build atlases for meteorology and for the turbulent fluxes.
A desktop GUI is planned and not written.

**Documentation: [fluxatlas.readthedocs.io](https://fluxatlas.readthedocs.io/en/stable/)**

## Install

```bash
pip install fluxatlas
```

or `uv add fluxatlas`. Python 3.12 or 3.13.

From a checkout, for development or to run the examples:

```bash
git clone https://github.com/holukas/fluxatlas.git
cd fluxatlas
uv sync
```

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
[command-line reference](https://fluxatlas.readthedocs.io/en/stable/cli.html).

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

The file has to be half-hourly, carry a timestamp, and use `-9999` or empty for missing. Half-hourly
is the scope rather than a current limit: a file on any other spacing is refused with its own
spacing named, and hourly or daily input is not planned.
[Files that are not FLUXNET-standardized](https://fluxatlas.readthedocs.io/en/stable/other-formats.html)
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

If you have a FLUXNET file, this is the whole of it — no mapping, no column names, no
units, because the registry already knows the convention they are named to:

```bash
fluxatlas EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv -o CH-Oe2_atlas.html
```

```bash
uv run python examples/build_fluxnet_atlas.py --input YOUR_FULLSET.csv --open
```

The same build from Python, printing what the file can supply, then the default build,
then every option beside the flag that sets it.

```bash
uv run python examples/build_lae_meteo_atlas.py --open
```

The other case: a local product whose columns were never named for FLUXNET, so they are
mapped by hand. Runs on the twenty-one-year CH-LAE extract committed in `examples/data/`,
and builds two atlases from one read — six variables, then air temperature alone.

[`examples/README.md`](examples/README.md) works through both, and the flags worth
knowing.

## Tests

```bash
uv run pytest
```

Most tests run on synthetic data, so the suite passes on a fresh checkout.

## Citing

Each release is archived on Zenodo. Cite the concept DOI, which resolves to whichever
version is current, unless the work depends on a particular release:

> Hörtnagl, L. *fluxatlas*. [doi:10.5281/zenodo.21815054](https://doi.org/10.5281/zenodo.21815054)

## Author

Lukas Hörtnagl, [Grassland Sciences group, ETH Zürich](https://gl.ethz.ch/)
([holukas@ethz.ch](mailto:holukas@ethz.ch)) ·
[github.com/holukas/fluxatlas](https://github.com/holukas/fluxatlas)

## License

GPL-3.0
