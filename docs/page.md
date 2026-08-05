# The built page

One HTML file. `calendar.js`, `calendar.css`, `base.css` and the mark are inlined into the template
when the page is rendered, so it opens from a memory stick with no server and no network.

## Three levels, one page

**The grid.** One tile per month, years down and calendar months across, coloured by the selected
metric and carrying badges for what was remarkable about that month. A tile can also show its own
days as a micro-strip, so a heat wave is visible as a streak before anything is clicked.

Read it down its columns as well as across its rows. There is a figure beside each year, a figure
under each calendar month, the trend of that column across the record, and the record's own figure
where the two margins meet. The same grid draws at four resolutions: months,
[seasons](seasons.md), years, or every day of the record as one raster. The raster is the only one
of the four that does not cut a spell in half at a boundary.

**The month.** Its statistics against the calendar-month normal, its rank among the same month of
every other year, and its badges spelled out with the numbers behind them. Then the month itself
from four directions:

- day by day: temperature against the climatological band, how far each day sat from its own
  normal, precipitation daily and accumulated, soil water against the rain that drives it, and
  radiation, evaporative demand and humidity each over their own normal band;
- the mean day of the month, composited from the hourly arrays, against the mean day of that
  calendar month across the record;
- where the month sits among its own years;
- a day calendar.

**The day.** Every variable's statistics for that day, the flags it set, and, where the hourly
arrays are included, the diurnal course of radiation, temperature and precipitation, each against
the mean day of that calendar month.

## The year scale

A month is judged against the same month of other years, and a season against the same season. A
year has no such slot to be judged against, so it is judged against every other year of the record.
That is the same machinery with one group instead of twelve: the normal behind a year is the record
mean, the rank is the place among all years, and the anomaly is the departure from the record.

The grid becomes one column, a year to the row, with the twelve months of the year in the margin
and the record in the foot row.

**Which badges travel to it.** Anything defined on a z-score, a percentage of normal or a rank
means the same thing over a year as over a month, so it travels. Counts of days do not: five frost
days is a remarkable January and an unremarkable year. The four turning points of the year drop out
too, because every year holds a last frost and a growing season, so at this scale they would land
on every tile and separate none of them.

**Seven badges exist at this scale alone**, because each is undefined below a year:

| Badge | What it marks |
| --- | --- |
| Net carbon sink, Net carbon source | The sign of the annual carbon balance. No month can state it: at most sites nearly every summer month is a sink and nearly every winter month a source. |
| Long growing season, Short growing season | The season ran at least ten days longer or shorter than the record median. The dates it began and ended belong to their months; only the year carries how long it lasted. |
| Late spring frost, Early autumn frost | A frost boundary moved by at least a fortnight, which shortens the frost-free period at one end. |
| A year of extremes | Four or more of the year's months departed at least two standard deviations from their own calendar-month normal. An annual figure can average out to nothing while the months inside it swing at both ends. |

The thresholds on the last one are set from the record rather than picked: at 1.5 standard
deviations and three months it marked 18 of the 21 CH-LAE years, which is a badge that says
nothing. At 2.0 and four months it marks 4, which is the rate the record badges run at.

### What stood out in a year

Opening a year gives everything a month gives, and one thing more: a ranked list of what set the
year apart from the others.

A badge is a threshold and a placing is not, and a year can miss every badge while being the third
warmest of twenty-one. So the list states placings, and each entry is ranked by how far the year
stood from the rest:

```text
Carbon balance      The site was a net sink of 158 g C m⁻² ± 16, 8th of 12 years.
Growing season      325 days long, 66 days longer than usual (259). 1st longest of 21 years.
Air temperature     2nd of 21 years. 10.6 °C, +1.0 against the record
Most unusual month  November: precipitation stood +2.5 standard deviations from its November
                    normal, and 3 of the 5 variables that could be judged stood at least 1 from
                    theirs.
```

The carbon balance leads whatever it placed, because the sign of the annual figure is the headline
statement of a flux year. The list is built in Python, where the other years are in hand: half of
what makes a year notable is its place among them, which the year alone cannot see.

## A page for each variable

The grid answers what happened in a given month. Each variable also has a page of its own, which
answers what that variable has done over the whole record. Reach it from the index under the grid,
or from the variable's label on any span panel.

**The trend of each calendar month, separately.** This is what the page exists for. One annual
slope is the average of twelve monthly ones, and averaging them hides the case worth seeing: a
record whose Januaries have moved three times as far as its Julys says something the annual figure
cannot. Each slope carries its 95 % interval, and a bar is solid where Kendall p is below 0.05.

The rest of the page:

- every year of the record as a line, with a band around it and the published Theil-Sen fit drawn
  through it, and the record halved into two means. The band is the published uncertainty where the
  file gives one; where it does not, a mean-aggregated variable gets one standard deviation of that
  year's own months instead, and the chart says which of the two it drew. A total with neither gets
  no band, because the spread of twelve monthly totals is not an uncertainty of their sum;
- the shape of the year: each calendar month's normal, one standard deviation either side, and the
  full range it has covered, with the year of each extreme;
- the five highest and five lowest months, each linking to its own panel, named from the registry's
  words for each end so that the highest five months of `NEE` are labelled as its largest releases;
- how much of each year was available and how much was measured, against the variable's warning
  line;
- the record day by day, in the two forms the span panel uses for a month. Every year is drawn
  along the year over the normal band for each date, since at this length what a daily scale can
  answer is where in the year the variable varies and where it holds still. Beside it, every day's
  departure from the normal for its own date, with the mean of those departures over a centred
  year: a departure that persists for years is a different thing from one that persists for a
  fortnight, and only the running line separates them.

Nothing on the page is computed twice. The slopes are the ones the grid's foot row prints, and the
fitted line is drawn from the two endpoints the build ships rather than re-fitted in the browser,
so a line cannot disagree with the number printed beside it.

## Why more than one chart per variable

Each of the month's charts answers something the others cannot.

A monthly anomaly is one number for thirty days. A uniformly mild month and a cold first week
followed by a hot last week produce the same number, and the daily departure chart separates them.

A monthly mean cannot say whether a warm month was warm at night or by day. The causes differ:
cloud and humidity hold the night up, radiation lifts the afternoon. The diurnal composite
separates those.

An anomaly cannot say whether a departure of one degree is remarkable for that calendar month or
ordinary. That is a question about the spread of the other years, which the rank strips draw rather
than summarise.

## What it computes, and what it must not

It aggregates and it compares. It corrects nothing. A value on the page is the value read from the
input file, converted to the canonical unit and otherwise untouched. The variable definitions and
the threshold-day definitions come from {mod}`fluxatlas.variables`, the one place a "hot day" is
defined.

Two rules keep the badges honest, and both are the [coverage rule](coverage.md) applied:

- a badge is a claim about a month, so a month that cannot support the claim does not make one, and
  the month view says which badges were suppressed and why;
- a normal is built from the years that can support one, and is withheld below
  `MIN_NORMAL_YEARS`.

## Layout of the month panel

{func}`fluxatlas.variables.family` returns `METEOROLOGY` or `FLUX`, and the month panel reads it.
Meteorology is listed first, then a labelled full-width break forces the fluxes onto their own row,
where they carry their own colour on the border, the label and the source line. The two groups are
measured differently, held to different warning lines and read differently, and a reader looking
for the carbon balance should not have to pick it out of the thermometers.

Every tile also names the column it was read from, in its bottom-right corner. A FULLSET file
carries a dozen variants of the same flux, and the title alone does not say which one produced a
number.

## Colour

Green is uptake and red is release throughout. `NEE` diverges about zero rather than about the
record mean, because the sign convention makes zero the meaningful boundary. See
[sign convention](variables.md#sign-convention-and-the-rank-that-follows-from-it).

Chart row labels are measured, not estimated. The left margin is sized from the real glyph widths,
and anything that still will not fit is shortened, with the full name kept in a `<title>`. A fixed
84 px margin ran "Gross primary productivity" off the edge of the card.

## The mark

`assets/logo.svg` is nine tiles of the anomaly grid, cold to warm along the diagonal. It is the
page's own object rather than a symbol standing in for it, and it uses only colours already in
`base.css`, so a change to the ramps cannot leave the mark behind.

One file has two uses, and the renderer derives the second from the first. The mark is inlined into
the topbar, and base64'd into a `<link rel="icon">` data URI, because a page that must work from a
memory stick cannot fetch an `.ico`. A test decodes the URI and asserts it still equals the file,
so the two cannot drift.

One tile is not a literal colour. The centre neutral reads `var(--neutral-mid, #d9d8d2)`, since a
fixed light grey disappears into the dark topbar. The inlined copy takes the page's value; the
standalone file and the favicon fall back to the light one.

## File size

The hourly arrays behind the diurnal charts are most of the output. A twenty-one-year FULLSET page
with them runs to about 6 MB. `--no-hourly`, or `hourly=False`, drops them, and costs the diurnal
composites and nothing else.
