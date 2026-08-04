# CLAUDE.md

## What this repo is

`fluxatlas` builds a standalone, browsable HTML page from the
**FLUXNET-standardized output** of an eddy covariance site: fluxes (NEE, GPP,
RECO, H, LE), meteorology, and their quality flags, resolved from the whole
record down to the single day. One site over decades is the target; several
sites is a later possibility, not a current requirement.

**Status: the library works for meteorological variables; nothing is released
yet.** PyPI still holds the 0.0.1 placeholder. `Atlas` builds and renders, and a
selection of one variable produces a correct one-variable page. The fluxes, the
CLI and the GUI are not written.

```python
import fluxatlas as fa

fa.available("CH-LAE_HH.csv")                                   # what the file carries
fa.build_atlas("CH-LAE_HH.csv", "atlas.html", variables=["TA"])  # TA and nothing else
```

## Module layout

| Module | Responsibility |
| --- | --- |
| `atlas.py` | The public API — `Atlas`, `build_atlas`, `available`. Everything a CLI or GUI would need belongs here, so both stay thin. |
| `io.py` | Reading one half-hourly FLUXNET file: timestamp, `-9999`, whole years, unit conversion, the measured/modelled split. |
| `variables.py` | The registry, keyed by canonical key (`TA`, `PREC`, …), each with the candidate FLUXNET columns that can supply it and the factor onto the canonical unit. |
| `stats.py` | Theil-Sen trend, spells, growing season, rounding — the estimators shared with the CH-LAE dashboards. |
| `build.py` | The ported computation: metrics, badges, day tests, normals, seasons, payload, render. The large one. |
| `assets/` | `calendar.js`, `calendar.css`, `base.css`, `template.html`, inlined into the output. |

**Selection is the organizing principle.** A metric whose variable is absent is
dropped, a badge whose `needs` are unmet is withheld with a reason, a day test
reading an absent variable is skipped, and a metric that would have no values at
all is not offered. When adding anything to a registry, ask what a one-variable
build does with it.

**The registry is a convenience, not a requirement.** The candidate column names
in `variables.py` are how a FLUXNET-named file is read without being told
anything. Any other half-hourly series is read by passing an explicit mapping:

```python
fa.Atlas(path, {"TA": {"column": "Lufttemperatur", "qc": "TA_FLAG"}})
```

The canonical key still has to be one the registry describes, because that is
where the units, thresholds and aggregation come from — only the column name is
the caller's. `io.resolve` is where the three accepted forms are documented.

## examples/ and tests/

`examples/data/CH-LAE_meteo_30min_2005-2025.parquet` (9.3 MB, committed) is a
twenty-one-year six-variable extract of the CH-LAE merged meteo product, cut
down by `examples/make_example_data.py` — that script needs the CH-LAE data
folder and is there for provenance, not as a step anyone else runs.
`examples/build_lae_meteo_atlas.py` builds a six-variable and a one-variable
atlas from it into `examples/output/` (ignored).

The example uses CH-LAE column names deliberately: it is the mapping case, which
is the general one. A FLUXNET-named file needs `variables=["TA"]` and nothing
more.

`pytest` — 78 tests, ~40 s. Most run on **synthetic** data built by
`tests/conftest.py`: a twelve-year half-hourly record with seasonal and diurnal
cycles, noise, and an imposed 0.8 K/decade warming the trend tests assert is
recovered. Twelve years because `MIN_NORMAL_YEARS` is 8 and nothing interesting
exists below it. The tests that read the bundled extract skip when it is absent,
so a fresh checkout still passes.

## What is planned, and deliberately not here yet

- **The fluxes** (NEE, GPP, RECO, LE, H). The registry, the metrics and the
  badges are all written for meteo; adding a flux means a `variables.py` entry
  plus metrics and badges that make sense for it.
- **A CLI.** `python -m fluxatlas` or a `fluxatlas` entry point over
  `atlas.build_atlas`. The argument surface the CH-LAE script had (`--vars`,
  `--out`, `--outdir`, `--no-hourly`, `--list`, `--open`) is a reasonable
  starting point.
- **Wider input than half-hourly.** Everything currently assumes 30-minute
  records: the reader reindexes onto a `30min` grid and the seasonal coverage
  denominators are `n_days * 48`. Hourly or daily input needs those two places
  generalized before it will give correct coverage.
- **A desktop GUI** for choosing the file and the variables. `available()`
  exists to feed exactly that picker.

Both front ends are meant to be thin wrappers. Anything either would need goes
in `atlas.py`, not in them.

## Where it comes from

This is the site-independent generalization of the **calendar explorer** in the
CH-LAE flux product repo:

- `F:\dev\datasets\dataset_ch-lae_flux_product\workflow\90_DATASET_OVERVIEW\build_calendar_explorer.py`
  — the working original: a grid of twenty-one years by twelve months, each tile
  coloured by a chosen metric, drilling down through months and meteorological
  seasons to a raster of every day, with statistics against calendar-month
  normals, ranks within the record, and published trends.
- `build_meteo_dashboard.py` beside it — the flat, one-page-per-variable
  companion. Worth reading for its variable registry and its assets/template
  split.

That repo is meteo-only and CH-LAE-only. The two things this project changes are
that the input is a FLUXNET-standardized file rather than the LAE meteo products,
and that fluxes are in scope alongside meteo.

**Nothing was removed from the CH-LAE repo**; the code was copied. The two will
drift, and that is accepted — the LAE script keeps its site-specific product
loading, its integrity checks and its `deploy.ps1` step.

What the port changed, beyond the data layer:

- `build_meteo_dashboard`'s `VARIABLES` + the script's own `CALENDAR` dict became
  one registry in `variables.py`; the per-variable page settings (`ship`,
  `digits`, `hourly`, `scale`, `short`) now live on `Variable`.
- The canonical key `SWC_0.2` became `SWC` — a depth is a CH-LAE fact.
- `sparse` badge: named TA and PREC, now reports on whatever is selected.
- `SpanStats.__missing__` returns 0 for `n_*` and `spell_*` so a badge may ask
  about a day test the selection dropped. Every other missing key is still a
  `KeyError`, which is what catches a genuine registry bug.
- Page copy that said "meteo" or "the exported products" was generalized.

The `calendar.js` renderer was copied nearly as-is and still contains references
to specific variable keys. It survives a one-variable payload — that is tested —
but expect to revisit it when fluxes arrive.

## Packaging conventions

Mirrored deliberately from **`diive`** (`F:\dev\diive`), the author's other
package. Keep them aligned unless there is a reason not to:

- hatchling build backend, flat layout (`fluxatlas/`, not `src/`)
- `license = { text = "GPL-3.0" }`
- `requires-python = ">=3.12,<3.14"` — the same pin as `diive` and the LAE repo.
  Note the upper cap will block installs on 3.14 and needs a release to lift.
- `authors = [{ name = "Lukas Hörtnagl", email = "holukas@ethz.ch" }]`

Build and publish:

```
uv build
$env:UV_PUBLISH_TOKEN = (Read-Host 'PyPI token'); uv publish
```

The `Read-Host` form keeps the token out of `ConsoleHost_history.txt`, which
records anything typed on the command line. Use a **project-scoped** token.
Trusted publishing from GitHub Actions is the intended path for real releases and
is not yet configured.

## Naming

Settled, so it does not need re-arguing. The name is one word everywhere —
distribution, import, and repo — because PyPI normalizes `fluxatlas` and
`flux-atlas` to the same registration anyway, while the import name cannot carry
a hyphen; matching them avoids a `scikit-learn` → `sklearn` style split.

"Atlas" was chosen for a collection organized over time rather than space. That
is well within the modern sense of the word (the Human Cell Atlas is organized
over cell type; a climate atlas is a set of monthly plates of normals and
anomalies, which is close to exactly what this produces).

## Hard rules

- **Commit only when explicitly asked**, never on your own initiative, and never
  `git push`. When asked, split the work into **logical groups** — one commit per
  coherent change, not one commit per session — and write subject + body with
  **no `Co-Authored-By` or "Generated with Claude Code" trailer**.
- **Never publish to PyPI.** Building (`uv build`) is fine; `uv publish` is the
  author's to run, since it is public and needs their token.

## Register

Scientific documentation, neutral and professional — the same register as the
CH-LAE repo, and for the same reason: the README and any generated page are read
by people deciding whether to cite the output. No colloquialisms, no jokes.
Direct imperatives to the reader are fine.
