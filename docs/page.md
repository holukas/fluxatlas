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
- the mean day of the month against the mean day of that calendar month across the record,
  composited from the hourly arrays or, where a build left them out, from the month-by-hour
  surfaces every page carries;
- at what hour the month departed from the record, each variable against its own mean day of that
  calendar month: what a monthly anomaly cannot say is whether a month was warm by night or by
  day, or whether its carbon balance moved at midday or overnight;
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

The thresholds on the last one are set against a real record rather than picked. A looser pair
marked most of the years, which is a badge that says nothing; these mark a handful, which is the
rate the record badges run at.

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

### The carbon balance through the year

Where the page carries `NEE`, a year's panel also draws the standard figure of a flux site: the
running total of daily net exchange from 1 January, one line per year, the open year drawn over
the others and the running total of the daily normals dashed. Below zero the balance since
1 January is net uptake and is tinted green; above it, net release and red. The tooltip gives the
year's running total with its direction, the normal by that date, the range of the other years and
the year's place among them, ranked as `NEE` is ranked everywhere else, so first is the largest
uptake. Selecting a date opens that day.

A day without a value adds nothing to a running total, which holds level across it. That is the
rule the accumulated precipitation of a span panel already follows, and the card states it and
counts the years it affects, since a year with missing days is short by whatever those days
carried.

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
- for a variable that sums (precipitation and the carbon fluxes), the total accumulated through the
  year, as described for the year panel above, with the last year of the record drawn over the
  others;
- on the air temperature and net exchange pages, **when the season ran each year**, one row per
  year on a day-of-year axis. On air temperature the bar is the growing season as the season badges
  date it: from the first run of six days with a daily mean above 5 °C to the first such run below
  it after 1 July. On net exchange each bar is an uptake period, a run of at least seven days in
  which the centred 15-day mean of daily NEE is below zero, and the year's count of uptake days
  (its sink days) is printed beside it. Start, end and length each carry a Theil-Sen slope per
  decade. The distinction matters: a season that lengthens because it starts earlier is a different
  finding from one that lengthens because it ends later. At a managed site the span from first to
  last uptake day says when uptake happened, not that it held throughout; a cropland can be a sink
  under one crop and again under a catch crop, and a source between them;
- for each of the variable's day tests, **the number of days each year that passed it**, with the
  longest run of consecutive such days beside the count where a run is defined. The two answer
  different questions: a year can reach a high count in scattered days and never hold the threshold
  for a week. Runs are counted within the calendar year, and a year the variable does not cover to
  its normal share shows as a dash rather than as a year with none;
- the five highest and five lowest months, each linking to its own panel, named from the registry's
  words for each end so that the highest five months of `NEE` are labelled as its largest releases;
- **through the day**: the record's mean for each hour of each calendar month as one twelve-by-
  twenty-four surface, and the mean day of each calendar month over the 10th to 90th percentile of
  the years. A variable that sums - precipitation and the carbon fluxes - is stated as its mean
  total per hour, so the twenty-four values of a month add up to its mean daily total. Hours are
  the file's own timestamps, which FLUXNET states in local standard time. A year's cell stands where
  the product covers the variable's normal share of its half-hours, the record's where at least
  eight years do, and the net exchange diverges about zero;
- the ten highest and lowest **days** of the record, by the daily statistic the variable's own
  charts use, and the ten highest and lowest **half-hours**, each linking to its day. Only records
  the file marks as measured are ranked, and a day must be at least 90 % measured, the share a day
  needs to set a record for its date. Half-hours are taken one per day, so a single afternoon cannot
  fill the list. A carbon flux's half-hours are stated in µmol m⁻² s⁻¹, the rate the file publishes,
  while its days stay in g C m⁻². An end the variable rests on rather than reaches as an event - no
  rain, a night without sunshine, humidity at 100 % on hundreds of days - is stated as a bound
  instead of listed;
- how much of each year was available and how much was measured, against the variable's warning
  line. GPP and RECO are modelled in every half-hour by partitioning the net exchange, so on their
  pages the bars are the share of that NEE which was measured, and the card names the NEE column;
- the record day by day, in the two forms the span panel uses for a month. Every year is drawn
  along the year over the normal band for each date, since at this length what a daily scale can
  answer is where in the year the variable varies and where it holds still. Beside it, every day's
  departure from the normal for its own date, with the mean of those departures over a centred
  year: a departure that persists for years is a different thing from one that persists for a
  fortnight, and only the running line separates them.
- **every hour of the record** in one picture, for the variables carried in the hourly layer: one
  column per day and one row per hour of it, midnight at the bottom, coloured by the hourly mean (or
  total, for a variable that sums) on the file's own clock. The daily cycle, the seasons and the
  years read together. The colour domain is the 1st to 99th percentile of the hours, so a few
  extreme hours do not wash out the rest, and the net exchange diverges about zero, green for uptake
  and red for release. Where the page is narrower than the record is long, a column is the mean of
  several days. Hovering reads one hour and selecting it opens that day. A page built with
  `--no-hourly` has no such chart and says so.

Nothing on the page is computed twice. The slopes are the ones the grid's foot row prints, and the
fitted line is drawn from the two endpoints the build ships rather than re-fitted in the browser,
so a line cannot disagree with the number printed beside it.

## Addresses

Every view has an address, so any of them can be bookmarked or sent as a link:

| Address | View |
| --- | --- |
| `#grid` | the grid |
| `#2016-05` | May 2016 |
| `#2016-JJA` | summer 2016, under the season scheme the page was built with |
| `#2016-YEAR` | the year 2016 |
| `#2016-05-12` | 12 May 2016, inside its month |
| `#var-TA` | the page of one variable |

After a `?` the address also carries the metric the grid is coloured by and the scale it is drawn
at, for example `#grid?metric=PREC_pctn&scale=season`. A choice at its default is left out.
Choosing a metric or a scale rewrites the address in place rather than adding a step to the
browser's history, so Back leaves the view rather than stepping through every metric it was shown
in. A reload, or a link opened elsewhere, restores both. An address without the `?` keeps whatever
was already chosen, which is how opening a month and coming back leaves the metric where it was.

The address is rewritten by a fragment navigation, which every browser permits on a page opened
from disk, where the history API may be refused.

## Downloading the grid

**Download CSV**, beside the scale picker, saves what the grid shows: the selected metric at the
selected scale, one row per year and one column per span, with the year's figure from the margin
as the last column. The unit is in every header, and the file is named for the site, the metric
and the scale, for example `CH-Oe2_NEE_season.csv`. At the day scale there is one column per
calendar date, 29 February included and left empty in the years that have none.

A span without a value is an empty cell. The file begins with a UTF-8 byte-order mark, because the
units carry characters outside ASCII and a spreadsheet opening a CSV without one misreads them.
It is built inside the page, so it works from disk with no server.

## The footer

The footer names the file the page was built from. Where the build records the file's size and
SHA-256, both follow the name; the hash is shown shortened and is copied whole, and hovering or
focusing it shows all of it. Beneath that, **What was read from the file** lists, for each variable,
the column it was read from, the quality flag that separated measured from gap-filled records, and
the factor that converted the column onto the unit the page states.

Everything the caller supplied - the site name and description, the file name, the column names
and the page title - is written as text, never as markup.

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
margin ran the longer variable names off the edge of the card.

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
with them runs to about 6.6 MB. `--no-hourly`, or `hourly=False`, drops them, and costs the day
panel's diurnal course and the hour-by-day picture on each variable page, and nothing else: the
month-by-hour surfaces are built either way, so the span panels' mean day and hour-by-hour
departures remain. The same page without the hourly arrays is about 2.9 MB.
