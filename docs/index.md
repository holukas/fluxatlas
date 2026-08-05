# fluxatlas

**Interactive explorer for FLUXNET-standardized ecosystem data.**

`fluxatlas` turns the half-hourly record of an eddy covariance site into one browsable HTML page.
It reads fluxes (NEE, GPP, RECO, H, LE), meteorology and their quality flags. Every month of the
record sits on one grid, and the grid opens down to the season, the month and the single day.

```{admonition} Version 0.1.0
:class: note

This is v0.1.0, the first release with any content. The library and the command line build atlases
for meteorology and for the turbulent fluxes, and there is no desktop GUI yet. Until the release
reaches PyPI, [installation](installation.md) is from source.
```

```bash
fluxatlas record.csv --list
fluxatlas record.csv -o atlas.html --vars TA,NEE,GPP
```

```python
import fluxatlas as fa

fa.available("CH-LAE_HH.csv")                                    # what the file carries
fa.build_atlas("CH-LAE_HH.csv", "atlas.html", variables=["TA"])  # TA and nothing else
```

The output is one HTML file. It carries its own scripts and styles, so it opens from a memory stick
with no server and no network.

## Where to start

- [Installation](installation.md): from source, with `uv` or `pip`.
- [Getting started](getting-started.md): a first atlas, from either front end.
- [The command line](cli.md): every option, generated from the parser.
- [Reading the input](input.md): what the reader accepts, and how to name your own columns.
- [Files that are not FLUXNET-standardized](other-formats.md): reading a half-hourly series named
  to any other convention, which is most of them.
- [Variables](variables.md): the registry, its canonical keys and the columns behind them.

## The ideas the page rests on

Four decisions shape what the built page states.

[Selection](selection.md)
: The variables you pass in are the whole build. A metric whose variable is missing is not offered,
  and a badge whose inputs are missing is withheld with the reason. An atlas of one variable is a
  smaller page, not a broken one.

[Coverage](coverage.md)
: Statistics are gated on availability. The measured share only warns. The gap-filled products are
  used, and what a figure rests on is stated beside it.

[Uncertainty](uncertainty.md)
: Turning a half-hourly uncertainty into a monthly one depends on whether the error is independent
  between records or one choice held across all of them. For the same u\* uncertainty, the two
  treatments differ by a factor of fourteen at annual scale.

[Seasons](seasons.md)
: You name the first season and the rest follow from it, so a site whose year is not divided into
  four is described in its own terms.

```{toctree}
:hidden:
:caption: Using it

installation
getting-started
cli
input
other-formats
variables
```

```{toctree}
:hidden:
:caption: How the page decides things

selection
coverage
uncertainty
seasons
page
```

```{toctree}
:hidden:
:caption: Reference

api
development
changelog
```

## Author

Lukas Hörtnagl, [Grassland Sciences group, ETH Zürich](https://gl.ethz.ch/)
([holukas@ethz.ch](mailto:holukas@ethz.ch)).

Every built page carries the same credit in its footer, since an atlas is one file that travels
away from whatever produced it.

## License

GPL-3.0. The source is at [github.com/holukas/fluxatlas](https://github.com/holukas/fluxatlas).

The page generalizes the calendar explorer built for the
[CH-LAE flux product](https://github.com/holukas/dataset_ch-lae_flux_product), which was tied to one
site.
