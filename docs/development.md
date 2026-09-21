# Development

## Module layout

| Module | Responsibility |
| --- | --- |
| `atlas.py` | The public API: `Atlas`, `build_atlas`, `available`. Anything a front end needs belongs here, so the front ends stay thin. |
| `cli.py` | The command line, a thin wrapper over `atlas.py`. `__main__.py` and the `fluxatlas` entry point both land here. |
| `io.py` | Reading one half-hourly FLUXNET file: timestamp, `-9999`, whole years, unit conversion, the measured and modelled split. |
| `variables.py` | The registry, keyed by canonical key, with the candidate columns for each and the factor onto the canonical unit. |
| `stats.py` | Theil-Sen trend, spells, growing season, rounding. The estimators shared with the CH-LAE dashboards. |
| `build.py` | The ported computation: metrics, badges, day tests, normals, seasons, payload, render. The large one. |
| `assets/` | `calendar.js`, `calendar.css`, `base.css`, `template.html`, `logo.svg`, inlined into the output. |

Both planned front ends are meant to be thin wrappers, so anything either would need goes in
`atlas.py` rather than in them.

## Tests

```bash
uv run pytest
```

About 197 tests, roughly two minutes. Most run on synthetic data built by `tests/conftest.py`: a
twelve-year half-hourly record with seasonal and diurnal cycles, noise, and an imposed 0.8 K/decade
warming that the trend tests assert is recovered. Twelve years, because `MIN_NORMAL_YEARS` is 8 and
nothing interesting exists below it. The tests that read the bundled CH-LAE extract skip when it is
missing, so a fresh checkout still passes.

`add_fluxes()` puts the five fluxes on top of that record. Three properties of it carry weight:

- the partitioning identity NEE = RECO - GPP holds exactly, so a test can assert it survives the
  unit conversion;
- the measured share varies month to month and two months are near-total outages, without which
  nothing ever falls under a warning line and every test about what the page says of a thin span
  asserts nothing;
- the u\* ensemble members are a constant factor off the reference, 0.90 to 1.10, never noise. That
  is what lets a test detect a systematic term put through a quadrature it should not be: the
  monthly half-spread must stay at 0.10 of the total rather than shrinking by √n.

### The renderer

Two tests cover it, and they answer different questions.

`tests/test_renderer_syntax.py` parses `calendar.js` and the inlined copy with `node --check`. The
renderer is one IIFE, so a syntax error blanks the whole page with nothing in the console but a bare
document.

`tests/test_renderer_smoke.py` runs it. The built page is loaded under jsdom and walked: the grid at
each of the four scales and under every metric, a span panel at each of the three span scales, a
day, every variable page, and an unknown hash. It fails on anything thrown, on a view that renders
almost no text, and on `undefined`, `NaN` or `[object Object]` reaching text a reader can see. Six
selections are driven, among them the fluxes with no air temperature and a build with no seasons,
because a renderer bug is usually specific to what was selected.

jsdom is a node package rather than a Python one, and is deliberately not a dependency of
`fluxatlas`. Install it once:

```bash
cd tests/js && npm install
```

```{admonition} What the suite still cannot catch
:class: warning

jsdom has no layout engine. Every measurement is zero or stubbed, so nothing that depends on a real
one - a chart margin, a tooltip that has to stay on screen, a grid that has to fit - is tested by
it. Neither is anything about how the page looks. Open the built page in a browser after touching
`calendar.js`. See [selection](selection.md#a-one-variable-build-is-the-test).
```

## Example data

`examples/data/CH-LAE_meteo_30min_2005-2025.parquet` (9.3 MB, committed) is a twenty-one-year
six-variable extract of the CH-LAE merged meteo product, cut down by
`examples/make_example_data.py`. That script needs the CH-LAE data folder and is there for
provenance, not as a step anyone else runs.

`examples/data/EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv` (552 MB) is a real FLUXNET
FULLSET record for the Oensingen cropland: 248 columns, 368,208 half-hours, 2004 to 2024. It is not
committed, and `.gitignore` excludes `examples/data/*.csv` so it cannot be added by accident. The
flux work was developed and checked against it, and every figure quoted in these pages comes from
it.

## Building the documentation

```bash
uv sync --extra docs
uv run sphinx-build -b html -W docs docs/_build/html
```

`-W` turns warnings into errors, which is what Read the Docs does through `fail_on_warning: true`
in `.readthedocs.yaml`. Build locally with it and a broken cross-reference will not first be found
by a hosted build.

```{admonition} What a local build cannot see
:class: warning

Read the Docs reads the sources in parallel, with `-j auto`. Parallel reading needs `os.fork`, so
`sphinx.util.parallel.parallel_available` is False on Windows and a checkout there builds serially
whatever it is asked for. A failure that only appears under a parallel read is therefore invisible
locally, and the hosted build is the first to meet it.

That is how `sphinx-argparse` got as far as Read the Docs twice. It declares itself safe to read in
parallel and registers a domain with no `merge_domaindata`, so Sphinx splits the read and then dies
merging the result. Declaring the extension unsafe instead only moves the failure, because Sphinx
then warns that it is unsafe and that it is reading serially, and `-W` turns both warnings into the
error that fails the build. `conf.py` supplies the missing method instead, and the CI job passes
`-j auto` on Linux so the next one is caught in a push rather than in a hosted build.
```

The hosted build installs the package and its `docs` **extra** with pip, from the same
`pyproject.toml`. That list is the only place the documentation dependencies are stated, so there
is no second requirements file to keep in step, which is the one packaging convention that departs
from `diive`.

It is an extra rather than a PEP 735 dependency group because a group is not reachable from a path
install, which is how Read the Docs installs a project. The property worth keeping is that the list
appears once; which installer reads it is not. The cost is that the hosted build resolves the
documentation dependencies fresh rather than from `uv.lock`, so it can pick up a newer Sphinx than
a local build has.

Two parts are generated rather than written, and both should stay that way. The API reference comes
from the docstrings. The variable, column and uncertainty tables come from the registry, through
the `fluxatlas-variables`, `fluxatlas-columns`, `fluxatlas-about` and `fluxatlas-uncertainty`
directives in `docs/_ext/registry_tables.py`. A page stating a unit the package does not use would
be worse than one stating nothing.

The CLI reference works the same way, generated from `fluxatlas.cli.build_parser` by
`sphinx-argparse`. That function exists so the parser can be rendered without running the command,
and adding an option to it adds the option to the documentation.

## Packaging

Taken from [`diive`](https://github.com/holukas/diive), the same author's other package. Keep them
aligned unless there is a reason not to:

- hatchling build backend, flat layout (`fluxatlas/`, not `src/`);
- `license = { text = "GPL-3.0" }`;
- `requires-python = ">=3.12,<3.14"`, the same pin as `diive` and the CH-LAE repository. The upper
  cap blocks installs on 3.14 and needs a release to lift;
- `authors = [{ name = "Lukas Hörtnagl", email = "holukas@ethz.ch" }]`.

## Releasing

The version is declared once, in `pyproject.toml`. `fluxatlas.__version__` reads it back from the
installed distribution and the page footer prints that, so nothing can claim a version other than
the one that ran. A test asserts the two agree and that the changelog opens with the same number.

1. Bump `version` in `pyproject.toml` and in `CITATION.cff`, and open a dated
   `## vX.Y.Z | D Mon YYYY` entry in `CHANGELOG.md`. A test asserts all three agree.
2. `uv sync`, so the installed metadata matches, then `uv run pytest`.
3. `uv build`, then push.
4. Publish a GitHub Release. Its "Choose a tag" field creates the tag on publish,
   from the target branch as the remote has it. Zenodo archives a published release
   and not a bare tag, so a tag on its own is not citable.
5. Publish to PyPI, which is the author's to run since it is public and needs their
   token:

```powershell
$env:UV_PUBLISH_TOKEN = (Read-Host 'PyPI token'); uv publish
```

The `Read-Host` form keeps the token out of `ConsoleHost_history.txt`, which records anything typed
on the command line. Use a project-scoped token. Trusted publishing from GitHub Actions is the
intended path for real releases and is not configured yet.

### What is checked, and where

`.github/workflows/tests.yml` runs on both supported Python versions, on every push to `main` and
`indev` and on every pull request. It installs with `uv sync --locked`, so a lockfile that has
drifted from `pyproject.toml` fails there rather than in a release; runs the suite, with node
present so the renderer is parsed rather than skipped; builds the documentation with `-W`; builds
the distribution; and checks that the wheel carries the five files in `assets/`.

That last one is worth having. The page is assembled from files beside the code, so a wheel built
without them would install cleanly, import cleanly, and then write a page with no styles, no
renderer and no mark. Nothing else would notice, because every other test reads the assets from the
source tree.

## What is planned

**A desktop GUI** for choosing the file and the variables. {func}`fluxatlas.available` exists to
feed exactly that picker.

## Where it comes from

This generalizes the calendar explorer in the CH-LAE flux product repository:
`build_calendar_explorer.py`, a grid of twenty-one years by twelve months drilling down to a raster
of every day, and `build_meteo_dashboard.py` beside it. That repository is meteo-only and
CH-LAE-only. This project changes two things: the input is a FLUXNET-standardized file rather than
the CH-LAE meteo products, and fluxes are in scope alongside meteorology.

Nothing was removed from the CH-LAE repository. The code was copied, and the two will drift.
