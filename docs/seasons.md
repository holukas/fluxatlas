# Seasons

The seasonal scale is the grid's second scale, built by the same machinery as the monthly one. A
season is judged against the same season of other years, exactly as a July is judged against Julys.

You name only the first season. The rest follow by stepping through the year in blocks of the same
length.

```bash
fluxatlas record.csv -o atlas.html --seasons DJF      # the default: the usual four
fluxatlas record.csv -o atlas.html --seasons JJA      # the same four, named from summer
fluxatlas record.csv -o atlas.html --seasons DJFMAM   # two half-years
fluxatlas record.csv -o atlas.html --seasons 12,1,2   # the same as DJF
fluxatlas record.csv -o atlas.html --seasons none     # no seasonal scale at all
```

```python
fa.build_atlas("record.csv", "atlas.html", variables=["TA"], seasons="DJFMAM")
```

## What the specification accepts

**Month initials.** Read as a run of consecutive months rather than letter by letter, because three
initials name two months each. `JJA` is June, July and August, since those three are consecutive
and no other reading is. `DFJ` is refused.

**Month numbers.** `12,1,2`, separated by commas or whitespace.

**`none`**, and also `off`, `no`, or empty. The scale is dropped, for a site whose year has no
seasons.

A season has to be 1, 2, 3, 4, 6 or 12 months long, so that the derived seasons tile the year
exactly once. Five months would leave a remainder with nowhere to go, and is refused with that
explanation. The value is validated before the file is opened.

## Naming, and what the page states

The four meteorological seasons have English names and are labelled with them. Anything else is
named by its months, which is the honest label for a division the page made at your request, and
the page states the scheme in a sentence:

> 2 seasons of 6 months, derived from the first one this atlas was built with: DJFMAM, JJASON. This
> is not the usual four-season division; every figure on this scale is taken over the months named.

Nothing about a tile labelled `JJASON` tells a reader it is half a year rather than a quarter, so
the page says it.

A one-month scheme cannot key on initials, since March and May are both `M`. The key identifies the
span in the payload, so such a scheme is keyed and labelled by the month abbreviation instead.

## The year a season belongs to

A season that crosses the new year is labelled by the year of its last month. A winter is the
winter of its January, which is the usual convention. `season_shift` derives which of a season's
months fall in the previous calendar year, so nothing hard-codes December.

Spans are grouped by `season_ids`, an integer `year * 100 + slot` built from the month.

## Which badges travel to the seasonal scale

Badges defined on a z-score, a percentage of normal or a rank travel, because they mean the same
thing over three months as over one.

Badges defined on a count of days, or on a run of them, do not. Five frost days is a remarkable
January and an unremarkable winter. The counts still appear on a season's page as numbers, not as
claims.

## What this replaced

`SEASON_FREQ = "Q-NOV"`, which borrowed pandas' quarters and could only ever express four equal
seasons.
