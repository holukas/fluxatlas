# Handover: port the remaining CH-LAE dashboard features into fluxatlas

fluxatlas grew out of the CH-LAE calendar explorer and per-variable dashboards, and it is the
improved version of both. A comparison of the two (27 Oct 2026) found that the calendar explorer is
fully covered, but several features of the CH-LAE per-variable dashboards and of its product
handling exist only in CH-LAE. This handover lists them. The goal is that everything CH-LAE can
show, fluxatlas can show too.

**Source of the features** (read-only reference, repository `dataset_ch-lae_flux_product`):

- `workflow/90_OVERVIEW/build_meteo_dashboard.py`: registry (`VARIABLES`, class `Variable`),
  `load_product`, `build_payload`, `build_reference`, `check_correction`, `ta_correction_checks`,
  `is_night`, `trend`, `longest_spell`, `growing_season`.
- `workflow/90_OVERVIEW/dashboard_assets/dashboard.js`: `sectionRecord`, `sectionYears`,
  `sectionSeasons`, `sectionThresholds`, `sectionCoverage`, `sectionReference`, `sectionTables`,
  `card`, `rangeChart`, `tiles`.

## Ground rules

1. **Add, do not change.** Every feature below is new and opt-in. A build that uses none of the
   new options must produce the same payload and the same page as today (apart from the build
   time). Add a regression test that builds the committed example data without new options and
   compares the payload with one written before the change.
2. **Keep the existing fluxatlas behaviour where it differs from CH-LAE.** These differences are
   improvements and stay as they are:
   - normals, ranks, badges and composite axes gate on the *available* share (`Coverage`), not on
     the measured share as in CH-LAE;
   - the `sparse` badge and the tile hatching use the `warn` level (50 % meteorology, 20 % fluxes);
   - an undocumented code of a built-in flag convention becomes `FILL_OTHER`;
   - the default variable set (`default=True`), the 28 February fold in `doy365`, the badges, the
     metrics and their wording, the grid scales, CSV export, designs and themes;
   - sums are gap-preserving (`min_count=1`); CH-LAE's dashboard sums turned an empty year into 0,
     which is a CH-LAE bug and must not be ported.
3. **New panels follow fluxatlas conventions**: its coverage gating, rank direction (NEE ranked
   from the low end), `extremes` wording, sign words, units, scaled integers, chart helpers
   (`mountChart`, `textWidth`, `trimText`), tooltips, design tokens and the light/dark repaint.
4. **Site-specific facts stay out of the code.** Everything CH-LAE-specific arrives through
   configuration (Python API and CLI) or through the example script, never through the registry.
5. Update `docs/`, `CHANGELOG.md` (v0.4.0, unreleased), the CLI help and the tests for each item.

## Features to add

### 1. Per-variable source or instrument flag

CH-LAE carries a second flag per variable that says which sensor, record or calibration a value
comes from (`FLAG_<var>_SOURCE`, `FLAG_SW_OUT_T1_47_1_INSTRUMENT`). It is independent of the
fill flag.

- Configuration: `source={column, legend}` per variable, where `legend` maps each code to a long
  and a short label. CLI: `--source KEY=COL` plus a legend file (JSON or YAML) given with
  `--legends FILE`.
- When a legend is given, every code present in the column must have an entry, otherwise the build
  stops and names the codes (CH-LAE `load_product` behaviour). This applies only to user-supplied
  legends.
- Payload: share of each code per year (year × code crosstab in %, indexed by every legend code).
- Variable page: card "Source per year": stacked 100 % bars per year, legend with the long labels,
  codes that never occur dropped; table of the shares.
- Span panel: the source of the span (share per code) beside the fill phrase.
- Footer "Columns read from the file": add the source column.

### 2. User-defined fill-code labels and measured codes

CH-LAE fill flags do not follow the MDS or FLUXNET conventions, for example TA: 1 XGBoost model,
2 timestamp-only fallback, 4 linear interpolation, 5 reconstructed from NABEL at 49 m.

- Configuration: `qc_legend={code: (long, short)}` and `measured_codes={...}` per variable. Without
  them the existing convention detection (`qc_convention`) and code 0 as measured stay in force.
- `measured_codes` may hold several codes. CH-LAE soil temperature needs `{1, 2}`: its
  `METHOD` flag is 0 no value, 1 measured current profile, 2 measured early profile, 3 and 4
  modelled.
- With a user legend, the fill phrase, the coverage bars and the footer use its labels; unknown
  codes stop the build (as in item 1).

### 3. Several instances of one variable (depths, heights)

CH-LAE has soil water content at five depths and soil temperature at seven, each a separate
series with its own years.

- Allow instances of a registry variable, keyed `BASE@LABEL` (for example `SWC@0.05`,
  `TS@0.15`), each with its own column, flags, legend and year window. An instance inherits unit,
  limits, aggregation, digits and `about` from the base entry.
- The plain key (`SWC`, `TS`) keeps its current meaning. The user chooses which instance stands in
  for it in the composite, the badges and the grid metric (`--primary SWC=SWC@0.2`). Without that
  choice nothing changes.
- Each instance gets its own variable page and its own entry in the variable index.
- Per-variable year window: `first_year`/`last_year` per variable (or instance) masks values
  outside it, for depths that exist only in part of the record (CH-LAE TS: 0.15 m 2005-2020;
  0.2 m and 0.6 m 2021-2025).

### 4. Outgoing radiation as variables of their own

- Add `SW_OUT` and `LW_OUT` to the registry as non-default METEOROLOGY variables, with candidates
  matching the existing NETRAD term candidates (`SW_OUT`, `SW_OUT_1_1_1`, `LW_OUT`,
  `LW_OUT_1_1_1`), unit W m-2, mean aggregation, limits (SW_OUT -100 to 1000, LW_OUT 100 to
  800), daily stats mean and max (SW_OUT) or mean (LW_OUT), extremes wording, `low_halfhour`
  False for SW_OUT.
- The NETRAD derivation and its term handling stay unchanged.

### 5. Measured twin of a corrected series

CH-LAE ships homogenised series beside the measured ones (TA, RH, VPD, PREC, SWC) and shows what
the correction did.

- Configuration: `raw=COLUMN` per variable (the uncorrected twin).
- Payload: `delta = value - raw` (rounded to 6 decimals): records changed, n, min, max, mean,
  number of distinct deltas; per era of the source flag (item 1) the same figures, the constant
  offset where an era has a single delta, and the first record of the reference code.
- Variable page: card "Correction": the figures as a table, the delta per year (mean, min, max)
  as a chart, and the user note (item 7) with the placeholders `{break_ts}`, `{offset}` and
  `{shield_max}` filled from these figures.
- Python API: an optional `checks=callable(delta, source)` per variable that may raise, so a site
  can assert its own correction (CH-LAE `ta_correction_checks`). No site check ships with
  fluxatlas.

### 6. Comparison with a reference station

CH-LAE compares TA, RH and PA with MeteoSwiss Lägeren (2.5 km, 845 m).

- New optional site constants: latitude, longitude, UTC offset of the data (`--lat`, `--lon`,
  `--utc-offset`). They are needed only for the night/day split below.
- Configuration: a reference file and, per variable, its reference column, a time shift
  (CH-LAE reference is on `TIMESTAMP_END`, shifted by -15 min onto the middle) and whether to
  split night and day. Station name, distance and elevation for the text.
- Computation (from `build_reference`), on measured records of the product only:
  - at least 10,000 overlapping half-hours, otherwise the comparison is withheld with its reason;
  - residual = product - reference; r, residual mean and SD;
  - night/day from the solar elevation (NOAA formula, night where cos(zenith) <= 0); use diive's
    potential radiation only if it is importable;
  - monthly mean residual per window (night, day, or all hours) and its 12-month centred rolling
    median (`min_periods=6`);
  - step across a hardware change when a source flag is configured: the break year is the year
    of the first record with the configured reference code; compare the three complete years
    before with the three after, the break year excluded, for all hours, night and day;
  - yearly residual mean, SD and n, per window.
- Variable page: card "Residual against <station>" (monthly residual thin, rolling median thick,
  a vertical mark at the hardware change) and a table card "Step across the hardware change"
  (window, before, after, step). Without a reference the section is absent.

### 7. Site notes per variable

- Configuration: `notes=[...]` and `correction_note=...` per variable (text, `{units}` substituted).
  They are shown in a notes block on the variable page, below the summary card. The registry
  `about` texts stay generic and unchanged.

### 8. Variable-page panels that CH-LAE has and fluxatlas lacks

Add these cards to `renderVariable`. Each has a table of the same numbers (see item 9).

| Card | Content (CH-LAE definition) |
|---|---|
| Anomaly stripes | one stripe per year, diverging colour around the record mean of the yearly values; table year, value, anomaly, rank |
| The daily record | whole-record daily band (min-max; mean-max for radiation; none for summed variables), the daily line (daily total for summed variables) and a 31-day centred running mean (`min_periods=10`) |
| Distribution per year | 5-95 and 25-75 % bands and median of the half-hourly values per year, plus the yearly mean for non-summed variables; for summed variables only half-hours > 0, labelled so |
| Monthly value by year and month | year x month heatmap, sequential |
| Monthly anomaly by year and month | year x month heatmap of the anomaly from that calendar month's mean, diverging |
| Climatology per calendar month | dot = monthly mean, bar = lowest to highest year (with the years), line = measured record low and high of the half-hours |
| Last year against the mean, by month and hour | 12 x 24 diverging heatmap of the last complete year minus the record mean (the mean surface itself already exists) |
| Missing share by year and month | year x month heatmap of the share not measured |
| Recent against earlier years | mean of the last 10 years against all earlier years: difference, and in % only where the earlier mean is at least the SD of the yearly values; if the record starts inside the window, say which period holds no data |
| New all-time records per year | days whose measured daily maximum exceeds the maximum of all earlier days (running `cummax`), and likewise for minima; the first year is left out; lows omitted where `low_halfhour` is False. This complements the existing records per calendar date |
| Longest gap per year | longest run of records not measured, in hours, attributed to the year it starts in; add to the coverage card |
| Year by year table | one table with value, anomaly, rank, measured min and max, threshold-day counts, growing-season length and GDD, new highs and lows, % not measured |
| Gap-fill check of the extremes | whether the gap-filled series stays inside the measured range; a note under the extremes card, a warning if it does not |
| Summary tiles | mean (or total) ± SD between years, trend per decade with interval and p, last 10 years against earlier, highest and lowest year, highest and lowest measured half-hour with its averaging window, measured share, growing-season length (TA). Keep the existing summary card; the tiles go above it |

### 9. Chart and table on every card, and a section index

- Every chart card on the variable page gets a Chart/Table switch (`aria-pressed`) showing the
  numbers behind the chart; table-only cards stay possible. Check first whether the variable page
  already has tables; add only what is missing.
- A section index at the top of the variable page (record, years, seasons, thresholds, coverage,
  reference, tables) that highlights the visible section; hidden on narrow screens.

## CH-LAE configuration for the example

Update `examples/build_lae_meteo_atlas.py` to use the new options with the merged CH-LAE meteo
file `99_METEO_MERGED_2004-2026.09.parquet` (13 products; partial 2026 is dropped as now). The
column names, flags and legends are in that file's `_INFO.md` and in `VARIABLES` of
`build_meteo_dashboard.py`. In short:

| Variable | Column | Raw twin | Fill flag (measured codes) | Source flag |
|---|---|---|---|---|
| TA | `TA_T1_47_1_HOMOGENIZED_gfXG` | `TA_T1_47_1_gfXG` | `FLAG_TA_T1_47_1_ISFILLED` (0) | `FLAG_TA_T1_47_1_SOURCE` |
| SW_IN | `SW_IN_T1_47_1_gfXG` | | `FLAG_SW_IN_T1_47_1_ISFILLED` (0) | |
| PPFD_IN | `PPFD_IN_T1_47_1_gfXG` | | `FLAG_PPFD_IN_T1_47_1_ISFILLED` (0) | |
| RH | `RH_T1_47_1` | | `FLAG_RH_T1_47_1_MISSING` (0) | `FLAG_RH_T1_47_1_SOURCE` |
| PA | `PA_T1_47_1` | | | |
| LW_IN | `LW_IN_T1_47_1` | | | `FLAG_LW_IN_T1_47_1_SOURCE` |
| VPD | `VPD_T1_47_1` | | `FLAG_VPD_T1_47_1_ISFILLED` (0) | `FLAG_VPD_T1_47_1_SOURCE` |
| PREC | `PREC_TOT_T1_47_1_HOMOGENIZED` | `PREC_TOT_T1_47_1` | `FLAG_PREC_TOT_T1_47_1_ISFILLED` (0) | `FLAG_PREC_TOT_T1_47_1_SOURCE` |
| SWC@d (0.05, 0.1, 0.2, 0.3) | `SWC_FF1_<d>_1_HOMOGENIZED` | `SWC_FF1_<d>_1` | | `FLAG_SWC_FF1_<d>_1_SOURCE` |
| SWC@0.5 | `SWC_FF1_0.5_1` | | | `FLAG_SWC_FF1_0.5_1_SOURCE` |
| TS@d (0.05 to 0.6) | `TS_FF1_<d>_HOMOGENIZED_GAPFILLED` | | `..._METHOD` (1, 2) | `..._METHOD` |
| G | `G_FF1_0.05_HOMOGENIZED` | | | |
| SW_OUT | `SW_OUT_T1_47_1` | | | `FLAG_SW_OUT_T1_47_1_INSTRUMENT` |
| LW_OUT | `LW_OUT_T1_47_1` | | | `FLAG_LW_OUT_T1_47_1_SOURCE` |

Composite and grid stand-in: `SWC=SWC@0.2`. Reference: MeteoSwiss Lägeren 30-min file
(`TA_LAE_MS`, `RH_LAE_MS`, `PA_LAE_MS`), shift -15 min, night/day split for TA and RH. Site:
47.478333 N, 8.364389 E, UTC+1. The legends and site notes are taken from the CH-LAE registry;
keep them in the example (or a legend file next to it), not in the package.

## Done when

- All items are implemented, opt-in, tested and documented.
- The regression test shows that a build without new options is unchanged.
- The CH-LAE example builds with every new option and shows each new card with data.
- The CH-LAE leftovers in the package are removed: the CSS headers naming CH-LAE, the unused
  `.sectionnav`/`.viewtoggle` rules if item 9 does not reuse them, and the docs statement that
  naming no variable builds every registry variable (the code builds the defaults).
