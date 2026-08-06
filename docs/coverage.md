# Coverage

Availability gates. The measured share only warns. Everything else on the page follows from that,
and it is a deliberate choice.

A span carries two coverage figures, and they answer different questions.

**Availability**
: What share of the span carries a value at all. For a gap-filled product that is 100 % wherever
  the product covers the span, and 0 % where it does not.

**Measured share**
: What share came from the instrument rather than from the gap-filling model.

## Every statistical gate reads availability

Normals, ranks, anomalies, badges and trends are computed wherever the product covers the span, at
whatever measured share. `TA_F`, `NEE_VUT_REF`, `GPP_NT_VUT_REF` and the rest are the series the
community publishes and analyses. A page that quietly declined to use them would describe a sparser
record than the file is of.

Two further gates apply to the comparisons. They are about how many years there are, not how much
of each:

- a calendar-month normal, and every anomaly, z-score and rank taken from it, is withheld below
  `MIN_NORMAL_YEARS` (8) qualifying years, so a sparse month is ranked against nothing and can
  never be "the driest on record";
- a slope is not stated below `TREND_MIN_YEARS` (10) qualifying years, and the two-epoch split
  needs `EPOCH_MIN_YEARS` (5) complete years in each half.

## The measured share warns

Below its variable's warning line, a span is hatched on the grid, carries the sparse badge, is
marked `tile-thin` in the month panel, and is counted in the build's console output. From the
CH-LAE example:

```text
warning: SW_IN is under 50 % measured in 10 of 252 months (lowest 0 % in January 2005);
  the gap-filled values are used and those months are marked on the grid
```

The figure is used either way, and the reader is told what it rests on.

### Two lines, because two things are being measured

```{eval-rst}
.. fluxatlas-variables::
   :family: meteorology
```

```{eval-rst}
.. fluxatlas-variables::
   :family: flux
```

Meteorology is measured almost continuously when it is measured at all, so a month that has fallen
under half measured is a real outage and worth flagging.

A turbulent flux cannot reach that, and not because anything failed. Half of every record is night,
and u\* filtering rejects the calm nights by design, so a half-hourly NEE that is around half
measured is a good one. Warning a flux at the meteorological line would flag every month of every
flux record ever produced, which says nothing. The line sits instead where a month stops being a
thin measurement and becomes very largely model.

## What this replaced

Both gates used to read the measured share, at thresholds set for meteorology. That gave two
silences.

- No month of any flux record reaches the meteorological threshold, so no flux normal, rank,
  anomaly, trend or badge was ever computed, and the sparse badge landed on every tile.
- Even at a threshold lowered for the fluxes, some calendar months had fewer than
  `MIN_NORMAL_YEARS` qualifying years, so they had no normal at all and stood blank on the anomaly
  grid.

Both are gone. Every variable of a real record now publishes a trend over its whole span, where
before most were withheld for want of qualifying years.

## What using the filled values costs

The measured share is not constant through a record. Where it rises over the years, as it does at
CH-Oe2, annual GPP correlates about as strongly with coverage as it does with time, so the GPP and
RECO slopes are entangled with the coverage improving.

The trend note used to claim that a slope is never a picture of changing coverage. With the old
gates gone, so is that guarantee, and the note now says which variables lean on the filling and by
how much.

```{admonition} The case that shows the gate still bites
:class: note

`RH` has no QC column, so its gaps are genuinely missing rather than filled. Its availability is
73.5 %, and its trend is withheld at 6 complete years. Correctly.
```

## The normal is not stationary, and the page says so

Every anomaly, standard score and rank is taken against the mean of the whole record. That mean is
not a fixed climate. Over twenty-one years the record itself moves, so a baseline drawn from all of
it sits between the early years and the late ones, and a late month is compared against a climate
that is partly no longer current. Unstated, the effect reads as weather.

So the trend is computed rather than assumed, published beside the grid, and never folded into the
comparison. Theil-Sen slope and Kendall's tau are taken down each column of the grid and over the
record as a whole, by {func}`fluxatlas.stats.trend`. The CH-LAE dashboards draw the same estimator,
so the two cannot disagree about the slope of a series. The foot row carries the slope under each
calendar month. The two-epoch split states the same thing as two numbers by halving the record,
which makes the size of the effect legible next to the single normal the rest of the page compares
against.

The baseline is not selectable, and that is deliberate. Badges are evaluated against the
whole-record normal, so a page that let a reader re-baseline the tiles would show tiles and badges
disagreeing about the same month. One baseline serves every claim, and the trend is published as
the fact that qualifies it.

## Where this lives in the code

`thin_spans` computes the counts, `report_thin_spans` prints them, `meta.thin` carries them to the
page, and `variables[].cov` carries the thresholds because the renderer reads them too.
{func}`fluxatlas.variables.coverage` answers the thresholds for a key from the registry alone.
