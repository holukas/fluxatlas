# Changelog

## v0.4.0 | Unreleased

Net radiation, the soil heat flux and six more FULLSET variables can now be read, and the
energy-balance closure and the evaporative fraction are computed from them. The page says how each
span was gap-filled, records exactly which file and columns produced it, keeps the chosen view in
its address, draws the carbon balance accumulated through each year, and offers the grid as CSV.
Several inputs that failed with a misleading error are now read or refused plainly, and text that
was true only of the CH-LAE site has been removed from every page.

A build of the 21-year CH-Oe2 FULLSET record is more than twice as fast, 2.8 s instead of 6.0 s on
the same machine. Every figure on the page is unchanged by that work, which was checked by comparing
the complete payload of three builds before and after.

### Added

- **Six more FULLSET variables, built when named:** soil temperature `TS`, wind speed `WS`, air pressure `PA`, incoming longwave `LW_IN`, photosynthetic photon flux `PPFD_IN` and friction velocity `USTAR`. Every candidate name, unit and limit was checked against the CH-Oe2 file. `USTAR` is grouped with the fluxes because it drops out when they do, but it is not gap-filled, so it warns at the meteorological 50 % and its statistics need 75 % of a span present.
- **Net radiation and the soil heat flux** (`NETRAD`, `G`). A FULLSET file publishes the four radiation components and not their sum, so where no `NETRAD` column exists it is computed as SW_IN − SW_OUT + LW_IN − LW_OUT, and every place that names the source says it was computed. A half-hour counts as measured only where every component was.
- **The energy-balance closure ratio** (H + LE) / (NETRAD − G) and **the evaporative fraction** LE / (H + LE), as monthly metrics in the Energy group. Each is withheld where its denominator is below a floor set from the CH-Oe2 record (40 and 20 W m⁻²), since both ratios lose meaning as the denominator approaches zero. On CH-Oe2 the median monthly closure is 88 %.
- **How each span was gap-filled.** The month panel and the variable page now say what share of a span was filled and how, in the words of the flag's own convention: a graded MDS flag (good, medium or poor quality fill), a consolidated `*_F` flag (gap-filled, or taken from reanalysis), or a flag whose convention is unknown. The two FLUXNET conventions give code 2 different meanings, which is why the legend follows the flag column rather than the variable. The page grows by about 0.5 %.
- **The page records which file and columns produced it:** the file's name, size and SHA-256 digest, and for every variable the column, flag and factor it was read with, in the footer and in a disclosure beneath it. `Atlas.provenance` returns the same record.
- **`Atlas.table(scale)`** returns the figures behind the tiles as a DataFrame, one row per month, season or year, read from the same payload the page is built from.
- **The total accumulated from 1 January, one line per year,** for the net exchange on the year panel and on the page of every summed variable, with the open year drawn over the others.
- **The chosen metric and scale are kept in the page's address**, so a link or a reload opens the same view. Every existing address keeps its form, and the fragment alone is rewritten, which works on a page opened from a file.
- **The grid downloads as CSV** for the current metric and scale: one row per year, one column per span, the year figure last, units in every header.
- **`--list` marks the variables a build takes only when named.**

### Fixed

- **A file whose timestamps carry a time zone is refused naming the zone**, where it used to be refused as not lying on the half-hourly grid while quoting a first stamp that did. FLUXNET timestamps are local standard time, so the message says how to convert rather than guessing an offset.
- **Rows without a timestamp are dropped and counted.** A single blank row at the end of a CSV, which spreadsheet software commonly leaves, stopped the read with a pandas error that named neither the file nor the column. A timestamp that is not a number is refused naming the column and the value.
- **GPP and RECO named by hand take the flag of the NEE of their own u\* selection.** `GPP_NT_CUT_REF` used to take `NEE_VUT_REF_QC`.
- **A column the registry does not list no longer inherits one of its flags.** A caller's own series named alongside a FULLSET column took that column's flag and reported its measured share from it.
- **The CSV reader no longer retries a read that ran out of memory** with the slower parser. It falls back only for the errors of a file its fast parser is too strict for.
- **Any page whose data contained `<!--` was blank.** The escape used for it was not valid JSON. Every `<` in the data is now written as `<`, and the page's placeholders are substituted in one pass, so no part of the data can be read as a placeholder.
- **Text the caller supplies is escaped** wherever the page prints it: the site name and description, the input's file name, column names and the title. A `<` in a site description broke the page.
- **Toggling the theme on a variable page threw**, and toggling it from a span panel left the grid's tiles in the old colours.
- **Page text that was true of one site only.** The near-saturation badge described a tower 47 m up on a ridge, the soil-water metric a sensor change in 2020, the net-sink badge a site that is a sink every summer, the composite a count of five axes whatever the build had, and several texts a forest. Each now states only what holds for any site.
- **A year's placing is taken from whichever end of the ranking it is nearer**, using the far-end rank rather than `n − rank + 1`, which ties made wrong. The same holds for the growing season, the frost-free period and the record days, and the words for the net exchange follow the side of zero the year is on.
- **The variable page's headings for its highest and lowest months** name the side of zero those months are on, so a site that is a sink in every month is not said to have its largest releases.
- **A percentage of normal is given only for a quantity with a true zero.** For air temperature in degrees Celsius it is meaningless, and one winter came out at −76 %.
- **The build's coverage warning** no longer says gap-filled values were used for a variable that has no flag and so was never gap-filled.
- **The trend falls back to SciPy's `kendalltau` if the private function it relies on fails in any way**, not only if it cannot be imported.
- **The page states the coverage rule it applies.** Five sentences still said a badge or a normal needs its month *measured* to a threshold, which stopped being the rule when the gates moved to availability; they now say *covered*, and that the measured share is stated rather than gated on.
- **`--list` sizes its columns to what the file supplies.** A computed net radiation names its formula where a column would be, and at a fixed width it pushed the rest of its row out of line.
- **`doy365` says where 29 February goes**, which is 28 February's slot and not 1 March's.

### Changed

- **A build that names no variables takes the same eleven as before;** the eight added here are built only when named. Taking every variable a FULLSET file supplies put the sparse badge on 216 of 252 CH-Oe2 months against 103, `PA`, which is mostly reanalysis there, accounting for 159 of them.
- **The "In cloud" badge is now "Near-saturated air"**, which is what a daily mean relative humidity of 95 % establishes at any site.
- **The footer is laid out as the author's other explorer pages are:** a *Data* paragraph with the site, the file, its size and digest, the years and the number of variables, then the columns that were read, a *Methods* paragraph stating how the normals, coverage, daily normals and trends are taken, and the tool with the build time written as a date with its UTC offset. It names fluxatlas's author as the tool's, not as the page's, since whoever runs a build made the page. Its prose keeps a reading measure instead of running across the full page width.
- **The build time is stated with its UTC offset.**
- **The examples say what the default build takes and show what is new.** `examples/README.md` opens with the current `--list` output and its marks, adds the energy-balance build with what decides whether net radiation and each ratio appear, and shows `Atlas.table()` and `Atlas.provenance`; `build_fluxnet_atlas.py` marks the variables built only when named and prints the table's size and the input's digest.

### Performance

- **Timestamps are parsed once, and without going through text.** The reader parsed the timestamp column twice, once for the spacing check and once for the index, and each parse turned 368,000 integers into strings for `strptime`; splitting the integers arithmetically takes about a seventh of the time.
- **The daily normals find each date's window once** and share it across every variable and statistic, which halves the time of that step.
- **Rounding a series for the page checks for missing values in one NumPy pass** and still rounds each value with Python's `round`, because `np.round` gives a different last digit for some values and a test now holds the two to the same answer.
- **The hourly layer converts its values to integers the same way**, instead of testing each of its roughly 184,000 hourly values per variable one at a time.
- **Trends are computed directly instead of through SciPy's public functions**, which spent most of their time on input handling for series of about 21 points; the new code repeats SciPy's arithmetic step by step, and a test holds it to SciPy's result to the last bit, including tied values and series longer than 33 years.
- **The statistics of each month, season and year are read from tables built once per scale** rather than looked up one value at a time in pandas, and each span's days are found by position rather than by date label.
- **The season and year each record belongs to are worked out once** and shared by every variable, since all of them sit on the same half-hourly index.

## v0.3.1 | 21 Sep 2026

Identical to v0.3.0 in every file that is installed. Release v0.3.0 was published before the
workflow that uploads to PyPI existed on the tagged commit, so it was archived on Zenodo but
never reached PyPI. This release is the same code published again with the workflow in place.

## v0.3.0 | 21 Sep 2026

This release fixes a number of bugs, several of which produced wrong numbers on a page with no
warning. The renderer is now tested by running it in a headless browser, the six carbon badges
also appear on seasons, the example scripts are easier to start from, and one slow step of the
build is much faster. Half-hourly input is now documented as the intended scope of the tool.

### Added

- **Releases are published to PyPI by GitHub Actions.** `.github/workflows/publish.yml` runs when a GitHub Release is published, checks that the tag matches the package version, builds, and uploads with trusted publishing, so no API token is needed.
- **A README for the examples**, which opens with the two commands needed for a FLUXNET file: `--list` to see what it
  contains and one call to build the page.
- **The renderer is now tested by running it.** `tests/test_renderer_smoke.py` loads the built page under jsdom, visits
  every view, and fails if anything throws or if `undefined`, `NaN` or `[object Object]` shows up in text a reader could
  see.
- **Six variable selections are covered by that test**, including the fluxes without air temperature and a build without
  seasons, because renderer bugs tend to depend on which variables were selected.
- **jsdom has to be installed separately** with `npm install` in `tests/js`; it is not a dependency of `fluxatlas`, the
  smoke tests skip without it, and CI installs it.

### Fixed

- **The six carbon badges now appear on seasons.** They already worked for months and years and were missing from
  seasons only because the list of badges that apply there was written before the fluxes existed.
- **The badge legend no longer lists a scale a badge does not apply to.** A frost-day count, for example, was shown as a
  season badge that no season ever earned.
- **A file with records closer together than 30 minutes is refused.** Before, a ten-minute file was silently reduced to
  every third record and reported as complete.
- **The uncertainty shown for a flux now belongs to the column that was actually read.** Selecting `NEE_CUT_REF` with
  `--var` used to show the uncertainty, note and column names of `NEE_VUT_REF`.
- **`--quiet` now silences the notice about dropped day tests.** It was the one message that ignored the flag.
- **Trends for seasons work with any number of seasons.** The code asked every year for four seasons regardless of the
  scheme, so `--seasons DJFMAM` produced no seasonal trend at all.
- **A column selected with `--var` keeps the unit conversion the registry knows for it.** `--var NEE=NEE_CUT_REF` used
  to lose the conversion from µmol to g C and fail the unit check.
- **A column selected with `--var` also keeps its quality flag**, using `<column>_QC` where it exists, so a flux
  selected this way no longer reports 100 % measured on a record that is half gap-filled.
- **`GPP_DT_VUT_USTAR50` and `RECO_DT_VUT_USTAR50` now show their uncertainty**, which had been linked only to the
  nighttime columns.
- **The growing season is counted in calendar days, not in available records.** Missing days now break a run of warm
  days instead of being skipped over, so the season no longer starts on a date the record does not contain.
- **The badges for the coldest, driest and largest-source span are awarded even when two spans tie**, which used to
  leave no span holding the last rank and no badge given.
- **Internal consistency checks no longer disappear under `python -O`.** They were written as `assert` statements, which
  the optimiser removes, and are now explicit checks that raise.
- **The check that every badge has an icon reads the icon table directly** instead of scanning `calendar.js` for
  indented quoted strings.
- **The ensemble branch of `aggregate_uncertainty` now says that it only supports summed variables.** Every current
  caller sums, so nothing changes, but the assumption was undocumented.
- **Ranks are only printed where there is something to rank against.** A record too short for a year-scale normal used
  to print "3rd largest uptake of None years" on every year tile.
- **Hovering or tabbing to a grid tile works at the season and year scales.** Both used to throw and show no tooltip.
- **Clicking a day in a season or year chart opens that day.** It used to produce a broken link and send the reader back
  to the grid.
- **The rank strips for net ecosystem exchange name the right end.** Rank 1 there is the largest uptake, not the highest
  value.
- **A year's day calendar is drawn as a year.** It was drawn as one 366-day month with no leading blanks and "undefined"
  in every cell's `aria-label`.
- **Seasons that cross the new year link to the right season from the month view.** December was hard-coded as the only
  month that belonged to the following season, which was wrong for a scheme such as `NDJF`.
- **Highlighted days in a span panel show the day of the month** and say which scale they are on, instead of an internal
  index and "in this month" everywhere.
- **The tooltip on the month-shape chart no longer reads "1 undefined"** outside the month scale.
- **The year panel draws the dashed record-normal line it announces.** The data for it is now included in the page.
- **The smoke test interacts with the page** by hovering and focusing tiles, moving the cursor over every chart, opening
  a day both ways, and checking `aria-label`, `title` and SVG `<title>` text as well as visible text.

### Changed

- **`examples/build_oe2_flux_atlas.py` is renamed to `examples/build_fluxnet_atlas.py`**, and it now shows what the file
  contains, then the default build, then each option with the flag and keyword argument that sets it.
- **The example script sets its output encoding to UTF-8**, as the command line already did, so printing a unit such as
  `W m⁻²` no longer crashes on an older Windows console.
- **Half-hourly input is documented as the scope of the tool** in the README, `docs/input.md` and
  `docs/other-formats.md`, and hourly or daily input is no longer listed as planned.
- **The documentation badge and links point at `latest`**, which is built from `main` on every push, instead of at
  `stable`.

### Performance

- **`longest_spell` uses a single numpy pass.** On the bundled 21-year extract its share of the build time drops from
  21.5 % to 2.2 %, with identical results.

### Removed

- **A redundant line in the span statistics** that wrote a wrong value to `{key}_daymin` and was immediately overwritten
  by the right one.

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
