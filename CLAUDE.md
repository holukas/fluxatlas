# CLAUDE.md

## What this repo is

`fluxatlas` builds a standalone, browsable HTML page from the
**FLUXNET-standardized output** of an eddy covariance site: fluxes (NEE, GPP,
RECO, H, LE), meteorology, and their quality flags, resolved from the whole
record down to the single day. One site over decades is the target; several
sites is a later possibility, not a current requirement.

**Status: the name is reserved, the implementation is not written.** PyPI holds
`fluxatlas` 0.0.1, which is a placeholder release — a docstring and a
`__version__`, nothing else. Treat any description of behaviour in this file as
intent rather than as a description of existing code.

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
