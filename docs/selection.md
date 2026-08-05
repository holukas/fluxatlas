# Selection

The variables you pass in are the whole build. Every part of the page then asks what it can still
say with them.

```python
fa.Atlas("record.csv", ["TA"])          # air temperature and nothing else
fa.Atlas("record.csv", ["NEE", "GPP"])  # carbon and nothing else
```

## What a smaller selection does

A metric whose variable is missing
: is not offered in the picker. It is dropped rather than greyed out, because a metric you cannot
  choose is not a fact about the record.

A badge whose inputs are missing
: is withheld with the reason attached. Every badge names the variables it reads, and the month
  view says which badges were suppressed and why.

A threshold-day test that reads a missing variable
: is skipped, and the build reports which tests it dropped and for want of which variable.

The cross-variable composite
: is withheld rather than computed over too few axes. It says something about several axes at once,
  and one axis will not carry it.

A metric that would have no values at all
: is not offered.

An atlas of one variable is therefore a smaller page, not a broken one. On the CH-LAE meteo extract
the six-variable build offers 20 metrics and 37 badge types; the air-temperature-only build offers
7 and 16.

## Why badges are withheld rather than dropped

A badge is a claim about a month. A month that could not support the claim and a month that did not
earn it are different states, and showing both as an absence would say the same thing about both.
So the reason travels with the withholding, and the month view states it.

The coverage gates work the same way. A sparse month is ranked against nothing and can never be
"the driest on record", and the page says that instead of ranking it anyway.

## A one-variable build is the test

When you add a variable, a metric or a badge, open a build of that variable alone in a browser.

The renderer was copied almost unchanged from the CH-LAE calendar explorer and still names specific
variable keys in places. Most of those are guarded. One was not: `seasonLine` read `se.TA.v`
outright, which threw for any selection without air temperature, such as the fluxes alone or
precipitation alone. Nothing caught it, because every build that had been tested included air
temperature. It now reads through `leadKey()`, and a test asserts the shape statically, since
pytest cannot execute the renderer.

```{admonition} The renderer is one IIFE
:class: warning

Any syntax error in `calendar.js` blanks the whole page. The markup loads, nothing draws, and no
error reaches a reader. A stray `;` inside a `chartCard({...})` string did exactly that while the
whole Python suite passed. There is no JavaScript parser in the test environment, so open the built
page after touching `calendar.js` and check the browser console.
```

## Selection in the API

Pass the selection as `variables` to {class}`fluxatlas.Atlas` or {func}`fluxatlas.build_atlas`, in
any of the forms [`resolve` accepts](input.md#naming-the-columns-yourself). `None` selects every
registry variable the file can supply, which is for looking at a new file rather than for normal
use.

{attr}`fluxatlas.Atlas.metrics` and {attr}`fluxatlas.Atlas.badges` report what a selection actually
produced, so you can see its effect without opening the page.
