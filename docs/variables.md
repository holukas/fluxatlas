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

## Adding a variable

Add an entry to `VARIABLES` in {mod}`fluxatlas.variables`. To be colourable on the grid it also
needs a metric in `build.METRICS`, and to earn badges it needs rules in `build.BADGES`. Neither is
required. A variable with neither is still read, still shown in the day panel, still counted in
coverage.

Ask what a one-variable build does with it, then open a build of that variable alone in a browser.
[Selection](selection.md#a-one-variable-build-is-the-test) explains why the Python suite cannot
catch that class of problem.
