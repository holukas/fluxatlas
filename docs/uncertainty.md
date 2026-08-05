# Uncertainty

A FULLSET file publishes uncertainty per half-hour. The page states figures per month and per year.
Getting from one to the other is the whole problem, and it turns on whether the error is
independent between records or one choice held across all of them.

On the CH-Oe2 record, the two treatments of the same u\* uncertainty differ by a factor of fourteen
at annual scale.

## Three kinds, three rules

| Kind | Rule | Behaviour |
| --- | --- | --- |
| `QUADRATURE` | `sqrt(Σσ²)` | Random, independent per record. Shrinks as √n, so it is small monthly and negligible annually. |
| `SYSTEMATIC` | `Σσ` | One choice applied across the whole span. Summed linearly, so it does not shrink. |
| `ENSEMBLE` | aggregate each member, then half the spread | The only correct treatment of a threshold choice. |

Components combine in quadrature into the figure the page shows.
{func}`fluxatlas.build.aggregate_uncertainty` applies the rules; the kinds are declared in
{mod}`fluxatlas.variables`.

The ensemble is worth spelling out. A u\* threshold moves the whole span together, so each
threshold version is aggregated over the span first, and half the spread of the totals is taken
after. Measuring the spread before the aggregation would put a systematic term through a √n that
does not apply to it.

## What each flux carries

```{eval-rst}
.. fluxatlas-uncertainty::
```

The u\* ensemble uses the 16th to 84th percentile versions. The 5th and 95th are left out: they are
the tails of the threshold distribution rather than a plausible central range, and including them
widens every interval by about half again.

## `*_JOINTUNC` is not used

It does combine the random and u\* terms, but only per record. Aggregating it puts the systematic
half through a √n that does not apply, and reports a median CH-Oe2 year as ±9 g C m⁻² where the
ensemble says ±121.

`LE_CORR_JOINTUNC` and `H_CORR_JOINTUNC` are `-9999` in every record of a real file in any case,
like `LE_CORR` itself.

## Two things the page must keep doing

**Name the components beside every interval.** A ± that covers the threshold choice is a much
larger claim than one covering only the random term, and the two differ by an order of magnitude.
So the components are named rather than left for a reader to assume the interval is total:

```text
Net CO₂ exchange, total   -306.62 g C m⁻²
  ± 21.24 g C m⁻² (random and u* threshold) · 1st of 21 such months (1st = largest net uptake)
```

**Never print ± 0.** The formatter adds decimals until it does not, because a zero interval reads
as certainty.

## Partial coverage of the uncertainty columns

The uncertainty columns are published for about three quarters of the records. Aggregating only
what is present would understate the span, so the result is scaled by the share carried. That
assumes the absent records resemble the present ones, which is the least the figure can assume
without either overstating it or leaving a quarter of the span out.

A variable whose uncertainty columns are missing from the file carries no interval, which is the
right outcome for a file that does not publish one.
