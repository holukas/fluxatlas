# Changelog

## Unreleased

The examples lead with the case most users are in, the renderer is now executed by the test suite
rather than only parsed, the six carbon badges are judged at the season scale as well as the month
and the year, and half-hourly input is stated as the scope of the tool rather than as a limit
waiting to be lifted.

### Added

- **`examples/README.md`**, which leads with the command a FLUXNET file needs and nothing else:
  `--list` to see what the file carries, then one call to build the page. The flags worth knowing
  come after it, each with the reason to reach for it, and the Python equivalent after those.

  `examples/` had no command-line example at all before this, and both of its scripts were named
  for a site rather than for a case, so a user arriving with their own FULLSET record had no
  obvious place to start. A FLUXNET file is the case that needs no configuration, and the examples
  now say so first.

- **The renderer is run, not just parsed.** `tests/test_renderer_smoke.py` loads the built page
  under jsdom and walks it: the grid at each of the four scales and under every metric, a span panel
  at each of the three span scales, a day, every variable page, and an unknown hash. It fails on
  anything thrown, on a view that renders almost no text, and on `undefined`, `NaN` or
  `[object Object]` reaching text a reader can see. Six selections are driven, among them the fluxes
  with no air temperature and a build with no seasons, because a renderer bug is usually specific to
  what was selected.

  This closes the gap that `node --check` could not: a page that parses and then throws looks
  exactly like one that does not parse, and a card reading a field only one scale carries usually
  does not throw at all - it renders the word `undefined` in a sentence. Both bugs of that shape
  that shipped were confirmed to fail the new test before it was committed.

  jsdom is a node package and is deliberately not a dependency of `fluxatlas`. It is installed on
  its own with `npm install` in `tests/js`, and the smoke tests skip without it, as the syntax tests
  already skip without node. CI installs it, so the renderer is executed on every push.

### Fixed

- **The six carbon badges are judged at the season scale.** `record_sink`, `record_source`,
  `sink_strong`, `sink_weak`, `gpp_high` and `gpp_low` are each a rank or a z-score against the
  span's own peer group, which is the stated criterion for a badge that travels, and each already
  worked at the month and the year scale. They were absent from a season only because the set that
  decides this was written before the fluxes existed. A season could show a carbon metric and then
  say nothing about it.

- **The badge legend no longer claims a scale a badge is not judged at.** The payload derived a
  badge's scales from `only` alone, which is one of three things that decide it, so a count of frost
  days was listed as judged at the season scale and reported zero seasons - which reads as "no
  season had one" rather than "this is not a claim a season makes". It is now asked of
  `badge_at_scale`, the one place that decides.

### Changed

- **`examples/build_oe2_flux_atlas.py` is now `examples/build_fluxnet_atlas.py`**, and is
  restructured so the default build comes first and the options come after it. The script always
  read any FLUXNET-standardized file; its name said it read one site's. It now prints what the file
  can supply, then the default build with nothing configured, then each option beside the flag and
  the keyword argument that set it. CH-Oe2 remains the default input, and it is still one page out.

- **The example prints units without dying on a Windows console.** It reconfigures `sys.stdout` to
  UTF-8 as `fluxatlas.cli.main` already did, which the example scripts bypass by calling the library
  directly. Listing what a file carries crashed on the first `W m⁻²` under a legacy console code
  page - which is where most of its readers are.

- **Half-hourly input is the scope, not a gap.** Everything assumes 30-minute records, and a file on
  any other spacing is already refused with its own spacing named. That is what an eddy covariance
  system produces and what FLUXNET distributes, so hourly and daily input are out of scope rather
  than planned; generalizing the two places that assume 30 minutes would buy nothing and would put
  every coverage figure on the page at risk. The README, `docs/input.md` and `docs/other-formats.md`
  say so, and it is no longer listed as planned work.

## v0.2.0 | 6 Aug 2026

The index is now the start of each averaging window, a file that is not half-hourly is refused
rather than half read, and the documentation builds. No figure on a page changes.

### Changed

- **The index is the start of the averaging window**, which is the stamp a FLUXNET file already
  carries, rather than the middle derived from both. A 30-minute window falls inside one day, one
  month and one hour whichever end of it is named, so every figure on the page is what it was; what
  changes is that the label a reader sees is the one in the column they read.

  A frame arriving on its own `DatetimeIndex` is now floored onto the window rather than taken at
  its word, which maps a start-stamped and a middle-stamped file onto the same index. **A
  start-stamped parquet file, which is what most local products are, could not be read at all
  before this.**

### Fixed

- **A file that is not half-hourly is refused, with its own spacing named.** Hourly stamps land on
  the half-hourly grid rather than missing it, so an hourly file would have been reindexed into a
  record that was half missing, with every coverage figure halved and nothing on the page to say
  why. The old index rejected such a file by accident; now it is checked.

- **The documentation could not be built by Read the Docs.** Three separate causes, each hidden
  behind the previous one: `search: enabled: true` is not a key the configuration has, and one
  unknown key fails validation before an environment is even created; the documentation
  dependencies were a PEP 735 dependency group, which is not reachable from the path install Read
  the Docs performs; and `sphinx-argparse` declares itself safe to read in parallel while
  registering a domain with no `merge_domaindata`, which crashes the parallel read that both the
  hosted build and the CI job run. `docs/conf.py` now supplies the missing method, guarded so a
  released fix upstream wins over it.
- **The CI job builds the documentation with `-j auto`**, as Read the Docs does. Parallel reading
  needs `os.fork`, so a Windows checkout builds serially whatever it is asked for and cannot
  reproduce a parallel-only failure at all.

### Added

- `CITATION.cff`, carrying the concept DOI that resolves to whichever version is current. Zenodo
  builds its record from it, so the ORCID and the affiliation on the archive come from there.
- Badges for the release, the documentation, the test run, the licence and the DOI.

### Changed

- **The README is cut to about half its length.** It had grown into a second copy of the
  documentation: read timings to the hundredth of a second, the derivation of the uncertainty
  aggregation, the argument for gating on availability. All of that is in the documentation, and a
  reader deciding whether to try this needs none of it. What stays is what someone does with the
  package. It also gains the mark, an install section it never had, and the author and citation at
  the end.
- The documentation links point at `stable` rather than `latest`, so a reader lands on released
  pages rather than on whatever is on `main`.
- Example column names are English rather than German, in the documentation, the command line's own
  help and two test files.
- The documentation dependencies are a `docs` **extra** rather than a dependency group. They are
  still stated in exactly one place.

## v0.1.0 | 6 Aug 2026

**First release.** Builds a standalone, browsable HTML page from the half-hourly
FLUXNET-standardized record of one eddy covariance site: fluxes, meteorology and their quality
flags, from the whole record down to the single day. The library and the command line work; the
desktop GUI is not written. This is the first version with any content: `0.0.1` on PyPI was a name
placeholder and carried none of this.

### Added

- **Public API** (`fluxatlas/atlas.py`): `Atlas`, `build_atlas`, `available`, `known_variables`.
  `Atlas` builds the payload once on construction, and `write` renders it as often as needed.
  Everything a front end would need lives here, so front ends stay thin.
- **Command line** (`fluxatlas/cli.py`, also `python -m fluxatlas`): `--list` reports what the
  registry finds in a file from the header alone. `--vars` names canonical keys, `--var
  KEY=COLUMN` names a column outright, and `--qc` and `--factor` refine a mapping. Also `--out`,
  `--seasons`, `--site`, `--site-long`, `--first-year`, `--last-year`, `--no-hourly`, `--title`,
  `--open`, `--quiet`.
- **Reader** (`fluxatlas/io.py`) for `.csv` and `.parquet`. The index is the middle of the
  averaging window, `-9999` becomes missing, partial first and last years are dropped, and each
  column is converted onto its canonical unit and then checked against the variable's limits.
  Accepts FULLSET names (`TA_F`), EddyPro FLUXNET output (`TA_EP`) and position-indexed biomet
  columns (`TA_1_1_1`), or an explicit mapping for a file named to any other convention.
- **Projected read.** The header is parsed first and the selection resolved against column names
  alone, so only the columns that survived are read. On a 552 MB, 248-column FULLSET file that is
  0.61 s and 59 MB against 21.07 s and 697 MB, and `--list` answers in hundredths of a second.
- **Variable registry** (`fluxatlas/variables.py`): `TA`, `PREC`, `SW_IN`, `VPD`, `RH`, `SWC`,
  `NEE`, `GPP`, `RECO`, `LE`, `H`. Each carries its candidate columns in preference order, the
  factor onto the canonical unit, quality-flag candidates, limits, aggregation, and its thresholds.
- **The carbon fluxes as totals in g C m⁻².** Each candidate converts from µmol CO₂ m⁻² s⁻¹ by
  `1e-6 * 1800 * 12.011` and a span is summed, so a tile reads as the carbon the site gained or
  lost. The sum preserves gaps. `NEE` resolves `VUT_REF` before `CUT_REF`; `GPP` and `RECO` resolve
  nighttime (Reichstein) before daytime (Lasslop) partitioning, and take their quality flag from
  the `NEE` they were partitioned out of.
- **Uncertainty aggregation** (`build.aggregate_uncertainty`) in three kinds. `QUADRATURE` for
  random error, which shrinks as √n. `SYSTEMATIC` for one choice held across a span, which does
  not. `ENSEMBLE`, which aggregates each u\* threshold version over the span and takes half the
  spread of the totals. Components combine in quadrature, and the page names which of them an
  interval covers. `*_JOINTUNC` is not used: aggregating it puts the systematic half through a √n
  that does not apply, and reports a median CH-Oe2 year as ±9 g C m⁻² where the ensemble says ±121.
- **Derived seasons.** `--seasons` names only the first season and the rest follow by stepping
  through the year in blocks of the same length, so `DJF` gives the usual four, `DJFMAM` gives two
  half-years, and `none` drops the scale. The length has to divide 12. Anything other than the
  canonical four is named by its months and stated on the page.
- **The page** itself: a grid of every month of the record, drawn at four resolutions (months,
  seasons, years, every day as one raster), opening down to a span panel and a day panel. Normals,
  ranks, anomalies, badges, threshold-day counts, spells, growing season, Theil-Sen trends per
  calendar month and over the record, and a two-epoch split. Output is one self-contained HTML file
  that works offline.
- **The year scale**, judged against the record rather than against a slot of the calendar: one
  group instead of twelve, so the normal behind a year is the record mean and the rank is the place
  among all years. Seven badges exist at this scale alone, each undefined below a year: `net_sink`
  and `net_source` for the sign of the annual carbon balance, `long_season` and `short_season` for
  the growing season against the record median, `late_frost` and `early_frost` for a frost boundary
  that moved by a fortnight, and `swings` for a year holding four or more months at two standard
  deviations from their own normals. Opening a year adds a ranked account of what set it apart,
  built where the other years are in hand, because half of what makes a year notable is its place
  among them.
- **A page per variable**, reached from an index under the grid or from the variable's label on any
  span panel. It carries the slope of each calendar month taken separately with its 95 % interval,
  every year of the record with the published Theil-Sen fit drawn through it, the shape of the year
  as normals with their spread and full range, the five highest and lowest months, the measured and
  available share of each year against the variable's warning line, and the record day by day in
  the two forms the span panel uses for a month. A January slope and a July
  slope are separate statements, and one annual figure averages the difference away.
- **A mark** (`assets/logo.svg`): nine tiles of the anomaly grid, inlined into the topbar and
  base64'd into the favicon from the same file.
- **Examples.** `examples/build_lae_meteo_atlas.py` builds a six-variable and a one-variable atlas
  from the committed twenty-one-year CH-LAE meteo extract. `examples/build_oe2_flux_atlas.py`
  builds one page from a FLUXNET FULLSET record and takes `--input`, `--vars` and `--out`.
- **Documentation** (`docs/`, built with Sphinx, hosted on Read the Docs). The API reference comes
  from the docstrings, the CLI reference from the argument parser, and the variable, column and
  uncertainty tables from the registry, so none of the three can drift from the code.
- **The sign convention written out wherever a signed figure appears.** `NEE` is negative for
  uptake and positive for release, so a tile reading `66 g C m⁻²` and `+75 against the normal`
  states a convention rather than a fact. Every figure now carries its direction in words: "net
  release", "less uptake than normal", and "about the same uptake as normal" inside a quarter of a
  standard deviation. The words come from a `sign` field on the registry entry, so a later variable
  whose zero is meaningful is covered by adding the field rather than by naming `NEE` in the
  renderer.
- **A guide for files that are not FLUXNET-standardized** (`docs/other-formats.md`): what a file
  has to satisfy, the three fields of a mapping, a worked conversion of a local product, the
  timestamp rule that catches most people, and the two things a mapped column gives up.
- **`node --check` over the renderer** in `tests/test_renderer_syntax.py`, for both the source and
  the inlined copy, skipping where node is absent. The suite had no JavaScript parser at all, and
  the renderer is one IIFE where a syntax error blanks the whole page silently.

### Decisions worth knowing

- **Selection is the organizing principle.** The variables passed in are the whole build. A metric
  whose variable is missing is not offered, a badge whose inputs are missing is withheld with the
  reason attached, a day test that reads a missing variable is skipped, and the cross-variable
  composite is withheld rather than computed over too few axes. An atlas of one variable is a
  smaller page, not a broken one.
- **Availability gates; the measured share only warns.** Normals, ranks, anomalies, badges and
  trends are computed wherever the product covers the span, at whatever measured share, because the
  gap-filled series are what the community publishes and analyses. Below its variable's warning
  line (50 % for meteorology, 20 % for the turbulent fluxes) a span is hatched on the grid, carries
  the sparse badge and is counted in the build's output. Both gates previously read the measured
  share, which left every month of every flux record flagged and three columns of the anomaly grid
  blank.
- **`NEE` is ranked from the negative end**, since the sign convention makes the most negative
  month the largest uptake. Rank 1 is the record sink, and the page says so.
- **The baseline is not selectable.** Badges are evaluated against the whole-record normal, so one
  baseline serves every claim, and the trend is published as the fact that qualifies it.

### Fixed while building the above

- **A season whose key was not three upper-case letters could not be opened.** The page's router
  matched `[A-Z]{3}`, so every derived scheme bounced back to the grid: `JF`, `DJFMAM` and the
  month abbreviations a one-month scheme uses (`Mar`) all failed to route.
- **The year margin's sparkline was coloured on the wrong domain** at the season scale, and would
  have been at the year scale too. It draws twelve months whatever the grid beside it shows, so it
  now asks for the monthly domain by name instead of taking the active one.
- **The season panel said "the three months of this season"** whatever the scheme defined. It
  counts them now.
- **"Every undefined in the record".** Eight card titles and legends in the span panel read
  `MONTH_NAME[state.m - 1]`, which a season and a year do not have. They take their wording from
  the active scale now.
- **An unreadable axis on any span longer than two months.** The day-by-day charts drew one tick
  per day, so a year drew 365 of them. Past two months the axis is labelled by the months inside
  the span, and the label count comes from the card width in both cases.
- **`record_sink` claimed "taken up" of months that released carbon.** Rank 1 is the most negative
  month, which is the largest uptake only where the month is a sink at all; where the calendar
  month is a source in every year of the record it is the smallest release. The two record badges
  are now "Best carbon balance on record" and "Worst carbon balance on record", and `sink_strong`
  and `sink_weak` are "Shifted toward uptake" and "Shifted toward release", which hold whichever
  side of zero the month sits on.
- **A start-stamped `DatetimeIndex` failed as "the column is empty".** The reader builds a
  half-hourly index on the middle of each window, so an index stamped at `00:00` reindexed to
  nothing and the error blamed the column. It now names the offset and the shift that fixes it.
- **Jargon that meant nothing where it appeared.** "On 4 axes at once", "Unusual axes" and bare
  "sd" are written out: "2 of 5 variables, by at least one standard deviation".

### Known limits

- Input has to be half-hourly. The reader reindexes onto a `30min` grid and seasonal coverage
  denominators are `n_days * 48`, so hourly or daily input needs those two places generalized
  first.
- No desktop GUI. `available()` exists to feed its variable picker.
- A page of a twenty-one-year record with the hourly layer is about 6 MB. `--no-hourly` drops the
  arrays behind the diurnal charts.

### Dependencies

- `pandas>=2.2`, `numpy>=1.26`, `scipy>=1.11` (Theil-Sen and Kendall's tau), `pyarrow>=15.0`
  (parquet input and the faster CSV read).
- `requires-python = ">=3.12,<3.14"`.

### Tests

- About 183 tests, most on synthetic data built in `tests/conftest.py`: twelve half-hourly years
  with seasonal and diurnal cycles and an imposed 0.8 K/decade warming the trend tests recover. The
  tests that read the bundled CH-LAE extract skip when it is missing.
