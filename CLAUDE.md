# CLAUDE.md

## What this repo is

`fluxatlas` builds a standalone, browsable HTML page from the
**FLUXNET-standardized output** of an eddy covariance site: fluxes (NEE, GPP,
RECO, H, LE), meteorology, and their quality flags, resolved from the whole
record down to the single day. One site over decades is the target; several
sites is a later possibility, not a current requirement.

**Status: `v0.1.0` is cut and dated in `CHANGELOG.md`; the library and the CLI
work for meteorology and for the turbulent fluxes.** `uv publish` has not been
run, so PyPI still holds the 0.0.1 name placeholder.
`Atlas` builds and renders, and a selection of one variable produces a correct
one-variable page. The GUI is not written. `CHANGELOG.md` carries an unreleased
`v0.1.0` entry; the documentation is in `docs/` and builds with Sphinx.

```bash
fluxatlas record.csv --list                                   # what the file carries
fluxatlas record.parquet -o atlas.html --var TA=air_temp --qc TA=TA_FLAG
```

```python
import fluxatlas as fa

fa.available("CH-LAE_HH.csv")                                   # what the file carries
fa.build_atlas("CH-LAE_HH.csv", "atlas.html", variables=["TA"])  # TA and nothing else
```

## Module layout

| Module | Responsibility |
| --- | --- |
| `atlas.py` | The public API — `Atlas`, `build_atlas`, `available`. Everything a front end would need belongs here, so they stay thin. |
| `cli.py` | The command line, a thin wrapper over `atlas.py`. `__main__.py` and the `fluxatlas` entry point both land here. |
| `io.py` | Reading one half-hourly FLUXNET file: timestamp, `-9999`, whole years, unit conversion, the measured/modelled split. Reads the header first and projects the read onto the selected columns. |
| `variables.py` | The registry, keyed by canonical key (`TA`, `PREC`, …), each with the candidate FLUXNET columns that can supply it and the factor onto the canonical unit. |
| `stats.py` | Theil-Sen trend, spells, growing season, rounding — the estimators shared with the CH-LAE dashboards. |
| `build.py` | The ported computation: metrics, badges, day tests, normals, seasons, payload, render. The large one. |
| `assets/` | `calendar.js`, `calendar.css`, `base.css`, `template.html`, `logo.svg`, inlined into the output. |
| `docs/` | Sphinx, MyST markdown, hosted on Read the Docs. Three parts are generated rather than written: the API reference from the docstrings, the CLI reference from `cli.build_parser` via `sphinx-argparse`, and the variable, column and uncertainty tables from the registry via `docs/_ext/registry_tables.py`. Do not write any of the three out by hand. |

**Selection is the organizing principle.** A metric whose variable is absent is
dropped, a badge whose `needs` are unmet is withheld with a reason, a day test
reading an absent variable is skipped, and a metric that would have no values at
all is not offered. When adding anything to a registry, ask what a one-variable
build does with it.

**The registry is a convenience, not a requirement.** The candidate column names
in `variables.py` are how a FLUXNET-named file is read without being told
anything. Any other half-hourly series is read by passing an explicit mapping:

```python
fa.Atlas(path, {"TA": {"column": "air_temp", "qc": "TA_FLAG"}})
```

The canonical key still has to be one the registry describes, because that is
where the units, thresholds and aggregation come from — only the column name is
the caller's. `io.resolve` is where the three accepted forms are documented.

**The file is read twice, and the first read is the header.** A FULLSET file is
248 columns and hundreds of megabytes; an atlas of six variables needs about
twenty of them. So `columns_of` parses the header (or the parquet footer schema),
`resolve` answers against the names alone, and `_read_frame` is then given
`usecols`. On the CH-Oe2 record that is 0.6 s and 59 MB against 21 s and 697 MB,
and `--list` returns in well under a second instead of reading the whole file.

The consequence to keep in mind: **`available` and `resolve` take column names,
not data.** Anything that needs to inspect values cannot live in them. The
all-`-9999` column is the case that proves it — `LE_CORR` and `H_CORR` are empty
in every record of a real CH-Oe2 file and resolve exactly like real columns, so
that is caught in `read_fluxnet` after the read and refused there.

## Coverage: availability gates, measurement only warns

**This is the rule everything else follows from, and it is a deliberate choice.**

A span carries two coverage figures and they answer different questions.

- **`avail`** — what share of it carries a value at all. For a gap-filled product
  this is 100 % wherever the product covers the span and 0 % where it does not.
- **`meas`** — what share came from the instrument rather than the gap-filling
  model.

**Every statistical gate reads `avail`.** Normals, ranks, anomalies, badges and
trends are computed wherever the product covers the span, whatever share of it was
measured. `TA_F`, `NEE_VUT_REF`, `GPP_NT_VUT_REF` and the rest are the series the
community publishes and analyses; a page that quietly declined to use them would
describe a sparser record than the file is of.

**`meas` gates nothing — it warns.** Below `varreg.coverage(key).warn` a span is
hatched on the grid, carries the sparse badge, has `tile-thin` in the month panel,
and is counted in the build's console warning. Meteorology warns under 50 %, the
fluxes under 20 %, because half of every eddy covariance record is night that u\*
filtering rejects by design — warning a flux at the meteorological line would flag
every month of every flux record ever produced.

`thin_spans` computes the counts, `report_thin_spans` prints them, `meta.thin`
carries them to the page, and `variables[].cov` carries the thresholds because the
renderer reads them too.

### What this replaced, and why

Both gates used to read `meas`: meteorology at 80/90, fluxes at 35/40. That
produced two silences.

- No month of any flux record reaches 90 % measured, so at the meteorological
  threshold no flux normal, rank, anomaly, trend or badge was ever computed, and
  the sparse badge landed on all 252 tiles.
- Even at 40 %, January, October and December of CH-Oe2 had fewer than
  `MIN_NORMAL_YEARS` qualifying years, so those calendar months had no normal and
  three columns of the anomaly grid were blank.

Both are gone. On CH-Oe2 every variable now publishes a trend over all 21 years,
where before `TA` was withheld at 7 complete years and every flux at 3.

**The cost is real and the page states it.** The measured share is not constant
through a record: at CH-Oe2 `corr(measured share, year) = +0.85`, and
`corr(annual GPP, measured share) = +0.57` against `corr(annual GPP, year) =
+0.51`. So the GPP and RECO slopes are entangled with coverage improving. The
trend note no longer claims "a slope is never a picture of changing coverage" —
that guarantee is gone — and says instead what leans on the filling and by how
much, via `thinNote()`.

`RH` is the case that shows the gate still bites: it has no QC column, so its gaps
are genuinely missing rather than filled, its `avail` is 73.5 %, and its trend is
still withheld at 6 complete years. Correctly.

## Seasons are derived, not fixed

`--seasons DJF` (the default) names only the **first** season; the rest follow by
stepping through the year in blocks of the same length. `DJFMAM` gives two
half-years, `none` drops the scale, and the length has to divide 12 so the scheme
tiles the year exactly once.

This replaced `SEASON_FREQ = "Q-NOV"`, which borrowed pandas' quarters and so
could only ever express four equal seasons. Spans are now grouped by
`season_ids`, an integer `year * 100 + slot` built from the month, and a season
that crosses the new year carries a `shift` map saying which of its months belong
to the previous calendar year — `season_shift` derives that, so nothing
hard-codes December any more.

Two things that bite when adding to this: a **one-month** scheme cannot key on
initials (March and May are both `M`) so it keys on the month abbreviation, and
`season_scheme` asserts the keys are unique because the key is the span's id in
the payload. Anything other than the canonical four is named by its months and
`season_note` states the scheme on the page.

## The four span scales, and what each is judged against

A tile is a **month**, a **season**, a **year**, or one **day** of the raster.
The first three are spans built by the same machinery, and the only thing that
differs between them is what a span is compared with:

| Scale | Peer group | `normals` grouping |
| --- | --- | --- |
| month | the same calendar month of other years | 12 groups |
| season | the same season of other years | one per season |
| year | **every other year of the record** | one group |

That last row is the whole of what the year scale is. `normals` already took the
grouping as an argument, so a year is one group: the normal is the record mean,
the rank is the place among all years, the anomaly is the departure from the
record. `year_periods`, `yearly_frames` and `year_events` are the year's versions
of the season functions beside them.

`badge_at_scale` is the one place that decides whether a badge is a claim a span
can make. Anything defined on a z-score, a percentage of normal or a rank travels
outward; counts of days do not, because five frost days is a remarkable January
and an unremarkable year. The four turning points travel to seasons and stop
there: every year holds a last frost, so at the year scale they would mark all
twenty-one tiles.

**Seven badges carry `only=("year",)`**, each undefined below a year: `net_sink`
and `net_source` (the sign of the annual carbon balance), `long_season` and
`short_season`, `late_frost` and `early_frost`, and `swings`. Their thresholds
were set against the record rather than picked: `swings` at 1.5 sd and three
months marked 18 of 21 CH-LAE years, which is a badge that says nothing, so it is
2.0 and four.

Opening a year adds `row["stood"]`, a ranked account of what set it apart, built
by `year_standout` **after every year row exists** — half of what makes a year
notable is its place among the others, which one year cannot see. The badges are
thresholds and this is a placing: a year can miss every badge and still be the
third warmest of twenty-one.

## A page per variable

`#var-TA` is a third view beside the grid and the span panel, reached from the
index under the grid or from any span tile's label. It is a **renderer** feature:
everything on it is already in the payload, and nothing is computed twice.

The centrepiece is the slope of each calendar month taken separately — that is
what the page exists for, since one annual slope is the average of twelve and
averaging them hides a record whose Januaries have moved and whose Julys have
not. `trend_of` ships `fit`, the two endpoints of the fitted line, so a chart
draws the slope it is stating rather than re-fitting one in the browser.

The band on the annual chart is whichever of two things the file supports, and
the chart names which it drew: the published uncertainty where there is one, and
otherwise, for a mean-aggregated variable, one standard deviation of that year's
own months. A **total** with no published uncertainty gets no band, because the
spread of twelve monthly totals is not an uncertainty of their sum.

## Variables whose sign means something

`NEE` is signed by the micrometeorological convention, and a bare `+66` states a
convention rather than a fact. So the registry carries
`sign=dict(low="uptake", high="release", zero="in balance")` and every place that
prints one of those numbers writes the direction beside it: `senseOf` and
`senseAnomaly` in the renderer, `carbon_phrase` in `build.py`.

Two rules that were got wrong once and should not be again:

- **The noun follows the normal, not the value.** `+75 g C m⁻²` is *less uptake*
  for a July that is normally a sink and *more release* for a January that is
  normally a source.
- **Rank 1 is not "largest uptake" where the calendar month is a source in every
  year** — it is the smallest release. The record badges are therefore
  `record_sink` "Best carbon balance on record" and `record_source` "Worst
  carbon balance on record", and `sink_strong` / `sink_weak` are "Shifted toward
  uptake" and "Shifted toward release", which hold whichever side of zero the
  month sits on.

Inside `SAME_AS_NORMAL` (a quarter of a standard deviation) a departure is
called neither more nor less but "about the same".

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

`examples/data/EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv` (552 MB, **not
committed** — `.gitignore` excludes `examples/data/*.csv` so it cannot be added by
accident) is a real FLUXNET FULLSET file for the Oensingen cropland: 248 columns,
368,208 half-hours, 2004–2024. It is what the flux work was developed and checked
against, and the source of every number quoted in this file.
`examples/build_oe2_flux_atlas.py` builds **one** page from it and takes `--input`
for any other FLUXNET file, `--vars` to narrow what goes on that page, and `--out`
for a directory outside the repository, which is worth using since a page of this
record with the hourly layer is ~6 MB. One file is the point — do not add a second
output to this script.

`pytest` — 183 tests, ~70 s. Most run on **synthetic** data built by
`tests/conftest.py`: a twelve-year half-hourly record with seasonal and diurnal
cycles, noise, and an imposed 0.8 K/decade warming the trend tests assert is
recovered. Twelve years because `MIN_NORMAL_YEARS` is 8 and nothing interesting
exists below it. The tests that read the bundled extract skip when it is absent,
so a fresh checkout still passes.

`test_years.py`, `test_variable_pages.py` and `test_renderer_syntax.py` are the
newest three. The first two assert what the payload has to carry for the year
scale and the variable pages, since neither can be exercised from Python
otherwise.

`add_fluxes()` puts the five fluxes on top of that record. Three properties of it
are load-bearing:

- the partitioning identity NEE = RECO − GPP holds exactly, so a test can assert
  it survives the unit conversion;
- the measured share varies month to month and two months are near-total outages,
  without which nothing ever falls under a warning line and every test about what
  the page *says* of a thin span asserts nothing;
- the u\* ensemble members are a **constant factor** off the reference (0.90 to
  1.10), never noise. That is what lets a test detect a systematic term being put
  through a quadrature it should not be: the monthly half-spread must stay at
  0.10 of the total rather than shrinking by √n.

## The fluxes

`NEE`, `GPP`, `RECO`, `LE`, `H`, with metrics in the `Carbon` and `Energy` groups
and six carbon badges. Three decisions are settled and should not be re-argued
without a reason:

- **Carbon is carried as a total in g C m⁻², not a mean of a rate.** Each
  candidate carries `UMOL_TO_GC` (1e-6 × 1800 s × 12.011) and `agg="sum"`, so a
  tile reads as the carbon the site gained or lost. The sum is gap-preserving,
  exactly as precipitation already was.
- **`NEE` resolves `VUT_REF` before `CUT_REF`**; a per-year u\* threshold is the
  right default over a record of decades.
- **`GPP`/`RECO` resolve nighttime (Reichstein) before daytime (Lasslop)**, one
  canonical key each rather than four. Neither is measured, so both take their
  `qc` from the `NEE` they were partitioned out of — that is why their `qc` lists
  name `NEE_*_QC` columns.

Sign convention is the micrometeorological one: negative NEE is uptake. Green is
uptake and red is release everywhere on the page, and `NEE` diverges about zero
rather than the record mean because zero is the boundary the convention makes
meaningful.

### Uncertainty: the aggregation kind matters more than the column

A FULLSET file publishes uncertainty per half-hour; the page states figures per month and per year.
**How a half-hourly uncertainty becomes a monthly one is the whole problem**, and it turns on
whether the error is independent between records or one choice held across all of them. On CH-Oe2
the two treatments of the same u\* uncertainty differ by **14× at annual scale**.

`varreg` defines three kinds and `build.aggregate_uncertainty` applies them:

| kind | rule | behaviour |
| --- | --- | --- |
| `QUADRATURE` | `sqrt(Σσ²)` | random; shrinks as √n |
| `SYSTEMATIC` | `Σσ` | one choice across the span; does not shrink |
| `ENSEMBLE` | aggregate each member, then half the spread | the only correct treatment of a threshold |

Components combine in quadrature. Per flux, from a real FULLSET file:

| | components | note shown |
| --- | --- | --- |
| `NEE` | `*_RANDUNC` + `NEE_VUT_16…84` ensemble | random and u\* threshold |
| `GPP` / `RECO` | `*_SE`, systematic | u\* threshold |
| `LE` / `H` | `*_RANDUNC` only | random |

**`*_JOINTUNC` is deliberately not used.** It already combines the random and u\* terms, but only
*per record* — aggregating it puts the systematic half through a √n that does not apply, and reports
a median CH-Oe2 year as ±9 g C m⁻² where the ensemble says ±121. **`LE_CORR_JOINTUNC` and
`H_CORR_JOINTUNC` are `-9999` in every record** of a real file anyway, exactly like `LE_CORR`.

Two things the page must keep doing: name the components beside every interval (`unc_note`), since
a ± covering the threshold choice is a much larger claim than one covering only the random term;
and never print `± 0` — `nfu()` adds decimals until it does not, because a zero interval reads as
certainty. Uncertainty columns are published for ~75 % of records, so an aggregate is scaled by the
share carried rather than silently leaving a quarter of the span out.

### Ranking runs the other way for NEE

`varreg.rank_first(key)` returns `"high"` (everything) or `"low"` (`NEE` alone). The sign convention
makes the most negative month the largest uptake, so ranked from the top the biggest carbon sink
would come out *last* of its calendar month. Rank 1 is therefore the record sink, `record_sink` and
`record_source` are the opposite way round from every other record badge, and the month tile prints
"(1st = largest net uptake)" — generated from `extremes`, so a variable cannot be ranked one way and
described the other.

`varreg.family(key)` returns `METEOROLOGY` or `FLUX`, and the month panel reads
it: the meteorology is listed first, a labelled full-width break forces the fluxes
onto their own row, and they carry `--series-3` on the border, label and source
line. Every tile also names the **column** it was read from in its bottom-right
corner — a FULLSET file carries a dozen variants of the same flux, so which one
produced a number is not something a reader can infer from the title.

Worth knowing when setting `limits`: they are a **unit** check, not a quality
check, so they are set outside the observed span rather than around it. Nighttime
partitioning legitimately returns negative GPP (−49 µmol m⁻² s⁻¹ on CH-Oe2), and
half-hourly `LE_F_MDS`/`H_F_MDS` reach ±1000 W m⁻². Three of the five bounds were
too tight on first writing and only the real file caught it.

## What is planned, and deliberately not here yet

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
to specific variable keys. Most are guarded by `if (VARS.TA)` and are fine. One
was not: `seasonLine` read `se.TA.v` outright, which threw for **any** selection
without air temperature — the fluxes alone, or precipitation alone — and was
never caught because every tested build included TA. It now reads through
`leadKey()`, and `test_the_renderer_never_dereferences_a_fixed_variable_on_a_span`
asserts the shape statically, since pytest cannot execute the renderer.

When adding a variable, check a build of **that variable alone** in a browser.
The Python suite cannot catch this class of bug.

**The renderer is one IIFE, so any syntax error in it blanks the whole page** —
markup loads, nothing draws, and no error reaches a reader. A stray `;` inside a
`chartCard({...})` string did exactly that while all 149 tests passed.
`test_the_renderer_has_no_statement_break_inside_a_card_literal` guards the one
shape that caused it, and `tests/test_renderer_syntax.py` parses both
`calendar.js` and the inlined copy with `node --check`, skipping where node is
absent. That catches syntax and nothing else — a page that parses and then throws
at run time looks identical to a blank one — so **open the built page after
touching `calendar.js`** and check the console.

The class of bug no parser sees is the renderer reading a field only one scale
carries. `MONTH_NAME[state.m - 1]` in eight card titles produced "Every undefined
in the record" on both the season and the year panel, and nothing failed.
Anything a panel prints goes through `scale()`, `peerOf`, `peerWord`, `spanNoun`
or `normalWord`; reaching for `mo.m` outside the month scale is the bug.

Chart row labels are measured, not estimated: `textWidth` sizes the left margin
off the real glyph widths and `trimText` shortens anything that still will not
fit, keeping the full name in a `<title>`. A fixed 84 px margin was running
"Gross primary productivity" off the edge of the card.

## Documentation

```bash
uv sync --group docs
uv run sphinx-build -b html -W docs docs/_build/html
```

`-W` matches Read the Docs, which builds with `fail_on_warning: true`. The `docs`
dependency group in `pyproject.toml` is the **only** place the documentation
dependencies are stated: Read the Docs installs it with `method: uv` from the
same `uv.lock`, so there is no second requirements file. This is the one
packaging convention that departs from `diive`, which predates that support.

`docs/other-formats.md` is the guide for reading a half-hourly file that is not
FLUXNET-named, which is most of them. Keep it in step with `io.resolve` and with
`_timestamp_index`: those two are what it documents.

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

**The version is declared once**, in `pyproject.toml`; `__init__.py` reads it back
from the installed distribution, as `diive` does, and the page footer prints that.
`tests/test_packaging.py` asserts the two agree, that the changelog and
`CITATION.cff` state the same number, and that the five files in `assets/` are installed - a wheel built
without them imports cleanly and then writes a page with no styles, no renderer
and no mark, which nothing else would catch because every other test reads the
source tree. `.github/workflows/tests.yml` runs the suite, the `-W` docs build and
that wheel check on 3.12 and 3.13.

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

### The mark

`assets/logo.svg` is nine tiles of the anomaly grid, cold to warm along the
diagonal — the page's own object rather than a symbol standing in for it. It uses
only colours already in `base.css`, so a change to the ramps cannot leave the mark
behind.

**It is one file with two uses, and `render` derives the second from the first.**
The mark is inlined into the topbar in place of the old gradient square, and
base64'd into a `<link rel="icon">` data URI, because a page that must work from a
memory stick cannot fetch an `.ico`. `test_the_logo_is_inlined_and_is_also_the_favicon`
decodes the URI and asserts it still equals the file, so the two cannot drift.

One tile is not a literal colour: the centre neutral reads
`var(--neutral-mid, #d9d8d2)`, since a fixed light grey disappears into the dark
topbar. The inlined copy takes the page's value; the standalone file and the
favicon, where no custom property is defined, fall back to the light one.

## Hard rules

- **Update `CHANGELOG.md` with the work**, under the unreleased `v0.1.0` entry,
  in the same terms the rest of it uses.
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
