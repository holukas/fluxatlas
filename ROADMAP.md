# Roadmap

What may come next, and what will not. Nothing here is a commitment or a schedule; `CHANGELOG.md`
records what exists. Every item has to keep the rules the package is built on:

- **The page shows the file's values as they are.** No setting rescales, masks or adjusts a value
  read from a file.
- **The page describes the record; it does not judge it.** No plausibility screens, no drift
  checks, no text that second-guesses a record the file marks as measured.
- **The input is half-hourly.**
- **Selection decides the page.** A new feature says what a one-variable build does with it, and a
  build that does not use it is unchanged.

## Open from the current work

- **Run the browser tests locally without extra steps.** The smoke tests need node and jsdom, and
  skip without them. Document a one-line setup in `docs/development.md`, or provide node through a
  Python package so that `uv sync` installs it.
- **The first year of the CH-LAE example.** The merged product carries 2004, and the example starts
  at 2005 through the atlas-wide `first_year`. Decide whether the example should show every whole
  year the file covers.
- **YAML legend files.** They need PyYAML, which is not a dependency. Offer it as an extra, or
  document JSON as the only format.
- **Confirm the browser tests on CI after the provenance change.** The footer's provenance text was
  reworded after the last full local run with the browser tests; the tests that read it passed, the
  full walk was not repeated.
- **GitHub Actions versions.** CI warns that Node.js 20 is deprecated for `actions/checkout@v4`,
  `actions/setup-node@v4` and `astral-sh/setup-uv@v5`, and that the `ubuntu-latest` label will move
  to Ubuntu 26. Move the actions to versions on a supported Node, and check the suite on the new
  runner image.

## Planned

- **A desktop GUI** for choosing the file, the variables and the site settings. `available()` feeds
  the variable picker; the GUI stays a thin wrapper over `atlas.py`.

## Ideas

### Configuration

- **Check a settings file against the file's header** before anything is read, as `--list` does for
  the registry: every column, flag and legend code named, with what is missing.

### The variable page

- **All instances of one variable together**: the depths of soil water or soil temperature on one
  chart, and as a depth-by-time surface. Each instance has its own page, but none shows the profile.
- **A record-wide list of events**: the longest heat spells, dry spells and wet spells of the whole
  record, each linking to its days. The spells exist per span; a list across the record does not.
- **Download any table as CSV.** The Chart/Table switch shows the numbers behind each card; a
  download beside it would hand them over without copying from the page.
- **A print view** of a variable page, with the tables in place of the interactive charts, for a
  report or a supplement.

### Accessibility

- **Keyboard access to the charts**: step through the points of a chart with the arrow keys and
  read the same tooltip a pointer reads.
- **A check of every colour pair in the designs** against the contrast the palette validator applies
  to the classic page, run as a test.

### Scale

- **Page size with many variables.** The CH-LAE example with every setting is about 6.7 MB. Measure
  which payload parts grow with the number of instances, and whether some can be built on demand in
  the browser from layers already shipped.
- **Several sites in one atlas**, each with its own record, compared on shared metrics. A later
  possibility, not a current requirement.

### Maintenance

- **Python 3.14.** `requires-python` caps below 3.14, as `diive` does; lifting the cap needs a
  release and a test run on 3.14.
- **A test that the CH-LAE example's configuration still matches the merged product**, skipped where
  the file is absent, as the extract tests are.

## Not planned

- **Hourly or daily input.** See `CLAUDE.md` and `docs/input.md`.
- **Converting, rescaling or masking values** beyond the registry's existing unit factors, including
  a unit factor for a reference station and per-variable year windows. Both were built and removed.
- **Data screening**: plausibility checks, spike detection, drift checks against reanalysis or
  timestamp-shift detection.
- **A selectable baseline.** Every badge is evaluated against the whole-record normal, and a page
  that let a reader re-baseline the tiles would show tiles and badges disagreeing about one span.
