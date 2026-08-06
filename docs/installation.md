# Installation

`fluxatlas` needs **Python 3.12 or 3.13**. The upper bound is a pin taken from `diive`; a release
will be needed to lift it for 3.14.

```bash
pip install fluxatlas
```

or `uv add fluxatlas`. That is all a reader of an atlas needs.

## From source

For development, or to run the examples, which read data files that are not in the distribution:

```bash
git clone https://github.com/holukas/fluxatlas.git
cd fluxatlas
uv sync
```

`uv sync` builds the environment from `uv.lock` and installs the package in editable form, together
with the `dev` group. The command line is then:

```bash
uv run fluxatlas --help
```

With `pip` instead:

```bash
python -m pip install -e .
```

## Dependencies

| Package | What it is for |
| --- | --- |
| `pandas` >= 2.2, `numpy` >= 1.26 | Reading, reindexing and aggregating the half-hourly record. |
| `scipy` >= 1.11 | Theil-Sen slopes and Kendall's tau, behind every trend the page publishes. |
| `pyarrow` >= 15.0 | Reading `.parquet` input, and the faster CSV reader used for the projected read. |

The built page needs nothing. `calendar.js`, `calendar.css` and the mark are inlined into the
output, so the file opens in any browser without a network.

## The documentation

The documentation builds from the same checkout. Its dependencies are the `docs` group:

```bash
uv sync --extra docs
uv run sphinx-build -b html docs docs/_build/html
```

The package has to be importable: the API reference comes from the docstrings, and the variable
tables are generated from the registry. `uv sync` installs it, so one command covers both.

## Checking the installation

```bash
uv run pytest
```

About 183 tests, roughly a minute. Most of them run on synthetic data built in `tests/conftest.py`,
so a fresh checkout passes with no data file present. The tests that read the bundled CH-LAE
extract skip when it is missing.
