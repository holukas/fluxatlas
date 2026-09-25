# Variables

The registry in {mod}`fluxatlas.variables` is keyed by a canonical key: `TA`, `PREC`, `NEE`, and so
on. The metrics, badges and day tests are written against that key, and the column that supplies it
is resolved per file. The tables below are generated from the registry when the documentation is
built, so they cannot state a unit the package does not use.

## What the registry describes

```{eval-rst}
.. fluxatlas-variables::
```

"A span is its" says how a month or a season is summarised: air temperature is a mean, carbon is a
total. "Warns under" is the measured share below which a span is marked as leaning on the
gap-filling. [Coverage](coverage.md) sets out the two lines and why they differ.

## What each one is

```{eval-rst}
.. fluxatlas-about::
```

## Which columns supply them

Resolution goes by name, in the order listed, with the factor that converts onto the canonical unit.
The first candidate present in the file wins.

```{eval-rst}
.. fluxatlas-columns::
```

A variable whose column is not among its candidates is read by
[naming the column](input.md#naming-the-columns-yourself). The canonical key still has to be one of
the above.

## The carbon fluxes

Three decisions here are settled, and each shows up in the tables.

**Carbon is a total in g C m⁻², not a mean of a rate.** Each candidate carries the conversion
1e-6 × 1800 s × 12.011 g mol⁻¹ from µmol CO₂ m⁻² s⁻¹, and a month is summed. A tile then reads as
the carbon the site gained or lost. The sum preserves gaps, as precipitation already did: a record
with no measurement contributes nothing rather than counting as zero. `LE` and `H` stay in W m⁻²
and average.

**`NEE` resolves `VUT_REF` before `CUT_REF`.** Over a record of decades, a per-year u\* threshold
is the better default.

**`GPP` and `RECO` resolve nighttime (Reichstein) partitioning before daytime (Lasslop)**, as one
canonical key each rather than four. Neither is measured, since both are partitioned out of the net
flux, so both take their quality flag from the `NEE` they came from. That is why their flag lists
name `NEE_*_QC` columns.

The resolved column is printed on the page, in the bottom-right corner of every month tile. A
FULLSET file carries a dozen variants of the same flux, and a reader cannot infer from the title
which one produced a number.

## Sign convention, and the rank that follows from it

The convention is the micrometeorological one: negative NEE is uptake. Green is uptake and red is
release everywhere on the page, and `NEE` diverges about zero rather than about the record mean,
because the convention makes zero the meaningful boundary.

That makes `NEE` the one variable ranked from the negative end. Ranked from the top like the
others, the largest carbon sink would come out last of its calendar month. So rank 1 is the record
sink, the record-sink and record-source badges are the other way round from every other record
badge, and the month tile prints "(1st = largest net uptake)". That phrase is generated from the
same registry field that sets the ranking, so a variable cannot be ranked one way and described the
other.

### The page writes the direction out

A figure of `66 g C m⁻²` and a departure of `+75` state a convention rather than a fact, and say
the opposite of the truth to a reader who assumes more is better. So the direction is written
beside every one of them, in words:

```text
Net CO₂ exchange, total   66 g C m⁻²
  net release · ± 100 g C m⁻² (random and u* threshold) · 75 g C m⁻² less uptake than normal
  · 15th of 21 years (1st = largest net uptake) · 52 % measured
```

Two rules decide the wording:

- **The noun follows the normal, not the value.** The same `+75 g C m⁻²` is *less uptake* for a July
  that is normally a sink and *more release* for a January that is normally a source.
- **Within a quarter of a standard deviation, a departure is neither.** It reads "about the same
  uptake as normal", because "2 g C m⁻² less uptake than normal" is a distinction without a
  difference next to the one-standard-deviation line every badge is defined at.

The words come from a `sign` field on the registry entry, so a later variable whose zero is
meaningful is covered by adding the field rather than by naming `NEE` in the renderer.

The same rule fixed two badges that had assumed the sign. Rank 1 is the largest uptake only where
the calendar month is a sink at all; where it is a source in every year of the record, rank 1 is
the *smallest release*. The record badges are therefore **Best carbon balance on record** and
**Worst carbon balance on record**, and the departure badges are **Shifted toward uptake** and
**Shifted toward release**, which hold whichever side of zero the month sits on.

## Friction velocity

`USTAR` is measured by the sonic anemometer of the eddy covariance system and lost in the same
outages as the fluxes, so the page groups it with them. Its coverage lines are its own. A FULLSET
file publishes it with no quality flag and no gap-filling, so its measured share and its available
share are the same number, and it is not removed by the u\* filter, which acts on the fluxes of calm
nights and not on u\* itself. It therefore warns under the meteorological 50 % rather than the flux
20 %, and its statistics are formed where a span is at least 75 % available rather than 90 %: on the
CH-Oe2 record the median month is 85 % available, and at 90 % only 46 of 252 months would carry a
normal.

## The energy balance

`NETRAD` and `G` complete the surface energy balance beside `H` and `LE`, and two ratios are
formed from the four in the `Energy` group of metrics:

- **Energy balance closure**, (H + LE) / (NETRAD − G), offered only where all four terms are in the
  build;
- **Evaporative fraction**, LE / (H + LE), offered wherever `H` and `LE` are.

Both are taken from the span's own means, and only where each term covers at least the share of
the span its normal requires. Both are unstable where their denominator nears zero, as the available
energy does in the winter months of a mid-latitude site, so a span is left without a value below
40 W m⁻² of available energy for the closure ratio and below 20 W m⁻² of H + LE for the evaporative
fraction. The thresholds were set by binning the CH-Oe2 record by its denominator: above them the
monthly ratios keep a stable spread, below them they scatter to negative values and past 4. The
figure beside each year and under each calendar month is the mean of the months that carry a value;
a year tile is the ratio of that year's own means.

### Net radiation computed from its components

A FULLSET file publishes the four radiation components and no net radiation. Where a file carries
no `NETRAD` column of its own but carries all four components, net radiation is computed from them:

```text
NETRAD = SW_IN − SW_OUT + LW_IN − LW_OUT
```

Each term takes the first of its candidates the file carries: `SW_IN_F` before `SW_IN_F_MDS` and
`SW_IN`, `LW_IN_F` before `LW_IN_F_MDS` and `LW_IN`. Modelled longwave (`LW_IN_JSB*`) and reanalysis
columns (`*_ERA`) are never used. A half-hour is counted as measured only where every component was:
where each flagged component carries a flag of 0, and the unflagged `SW_OUT` and `LW_OUT` are
present. A half-hour in which any component is missing has no net radiation.

The figure is derived, not corrected, and the page says so. The column named in the corner of each
tile, and on the variable's own page, is the formula in the file's own column names, for example
`computed: SW_IN_F − SW_OUT + LW_IN_F − LW_OUT`.

## Adding a variable

Add an entry to `VARIABLES` in {mod}`fluxatlas.variables`. To be colourable on the grid it also
needs a metric in `build.METRICS`, and to earn badges it needs rules in `build.BADGES`. Neither is
required. A variable with neither is still read, still shown in the day panel, still counted in
coverage.

Ask what a one-variable build does with it, then open a build of that variable alone in a browser.
[Selection](selection.md#a-one-variable-build-is-the-test) explains why the Python suite cannot
catch that class of problem.
