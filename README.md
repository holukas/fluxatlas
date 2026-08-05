# fluxatlas

Interactive explorer for FLUXNET-standardized ecosystem data.

`fluxatlas` builds a standalone, browsable page from the half-hourly
FLUXNET-standardized output of an eddy covariance site — every month of the
record on one grid, drilling down to the season, the month and the single day.

> **In preparation.** The library and its command line build atlases for both
> meteorology and the turbulent fluxes. A desktop GUI is not written yet, and
> nothing beyond the 0.0.1 placeholder is on PyPI.

## Command line

```bash
fluxatlas record.csv --list
```

`--list` reports which variables the registry can find, and which it cannot. Where
the file uses FLUXNET names, that is all you need:

```bash
fluxatlas record.csv -o atlas.html --vars TA,PREC
```

Where the columns are named to some other convention — which is most real files —
name them:

```bash
fluxatlas record.parquet -o atlas.html --var TA=Lufttemperatur --qc TA=TA_ISFILLED
```

Seasons default to the four meteorological ones. Define the first and the rest
follow from it:

```bash
fluxatlas record.csv -o atlas.html --seasons DJFMAM
```

`DJF` gives the usual four, `DJFMAM` gives two half-years, `12,1,2` is the same
as `DJF`, and `none` drops the seasonal scale for a site whose year has no
seasons. A season has to be 1, 2, 3, 4, 6 or 12 months long so the derived
seasons cover the year exactly once, and anything other than the usual four is
stated on the page: a tile labelled `JJASON` is half a year, not a quarter.

`--qc` names the quality flag beside a column (0 measured, above 0 modelled) and
`--factor` converts it onto the canonical unit, e.g. `--factor VPD=0.001` for Pa
to kPa. Both forms combine, so registry-found and hand-named variables can appear
in one build. `python -m fluxatlas` is the same entry point.

## Use as a library

```python
import fluxatlas as fa

# What can this file supply?
fa.available("CH-LAE_HH_2016-2025.csv")
# {'TA': {'column': 'TA_EP', 'factor': 1.0, 'qc': None, 'units': '°C', ...}, ...}

# An atlas of air temperature and nothing else
fa.build_atlas("CH-LAE_HH_2016-2025.csv", "atlas.html", variables=["TA"])

# Several variables, and the payload kept for inspection
atlas = fa.Atlas("CH-LAE_HH_2016-2025.csv", ["TA", "PREC", "VPD"], site="CH-LAE")
atlas.metrics          # what the grid can be coloured by, for this selection
atlas.badges           # badge key -> how many months earned it
atlas.write("atlas.html")
```

The output is one self-contained HTML file that works offline.

## The selection decides the atlas

The variables passed in are the whole build. A metric whose variable is absent
is not offered, a badge whose inputs are missing is withheld with the reason
attached rather than silently skipped, a threshold-day test that reads an absent
variable is dropped, and the cross-variable composite is withheld rather than
computed over too few axes. An atlas of one variable is a smaller page, not a
broken one.

## Reading the input

The reader accepts what "FLUXNET-standardized" means in practice: FLUXNET2015 /
ONEFlux FULLSET names (`TA_F` with `TA_F_QC`), EddyPro's own FLUXNET output
(`TA_EP`), and position-indexed biomet columns (`TA_1_1_1`). Each canonical
variable lists the columns that can supply it, in preference order, with the
factor that converts them onto the canonical unit — vapour pressure deficit is
hPa in FULLSET and Pa in EddyPro output, and both become kPa.

`-9999` becomes missing before anything is computed, the index is the middle of
the averaging window so no record lands on the wrong day, and partial first and
last years are dropped because the grid is a whole number of years.

A FULLSET file is wide — the CH-Oe2 record below is 248 columns over twenty-one
years of half-hours, 552 MB — and an atlas of six variables needs about twenty of
them. So the header is read first, the selection is resolved against the column
names alone, and only then is the file read, for the columns that survived:

| the CSV read step | time | memory |
| --- | --- | --- |
| header only | 0.18 s | — |
| the selected columns | **0.61 s** | **59 MB** |
| all 248 columns | 21.07 s | 697 MB |

The bytes still have to stream off disk either way; what projection removes is
tokenizing, converting and allocating the 228 columns nothing asked for. End to
end — resolution, timestamps, reindexing onto the 30-minute grid, unit conversion
and the measured split — `read_fluxnet` on that file takes about 2.6 s, whether
one variable is selected or all eleven.

`available()` answers from the header alone, so `--list` on that file returns in
hundredths of a second. A column that is present but was never filled — `LE_CORR`
and `H_CORR` are `-9999` in every record of that file — cannot be seen by a
header scan, so it is caught after the read and refused with the alternatives
named, rather than becoming a variable with an empty grid.

Where a `_QC` column exists, 0 means measured and anything above it is modelled;
that split drives every coverage rule on the page. A file without QC columns is
read as measured wherever it is not missing, which is the most that can be
concluded from it.

## Any half-hourly series, not only FLUXNET files

The candidate column names are a convenience. A file whose columns were named to
some other convention is read by naming them:

```python
fa.Atlas("local_record.parquet", {
    "TA":   {"column": "Lufttemperatur", "qc": "TA_FLAG"},
    "PREC": {"column": "Niederschlag"},
    "VPD":  {"column": "vpd_pascal", "factor": 0.001},   # into kPa
})
```

The canonical key still has to be one the registry describes — that is where the
units, thresholds and aggregation come from — but the column is yours to choose.

## Variables

| | |
| --- | --- |
| Meteorology | `TA`, `PREC`, `SW_IN`, `VPD`, `RH`, `SWC` |
| Carbon | `NEE`, `GPP`, `RECO` |
| Energy | `LE`, `H` |

The carbon fluxes are carried as **totals in g C m⁻²**, not as means of an
instantaneous rate: each candidate column converts from µmol CO₂ m⁻² s⁻¹ by
1e-6 × 1800 s × 12.011 g mol⁻¹, and a month is summed. So a tile reads as the
carbon the site gained or lost, and the sum is gap-preserving in the way
precipitation already was. `LE` and `H` stay in W m⁻² and average.

Where a file publishes more than one variant, `NEE` resolves to the variable u\*
threshold reference selection (`NEE_VUT_REF`) before the constant-threshold one,
and `GPP`/`RECO` resolve to nighttime (Reichstein) partitioning before daytime
(Lasslop). The resolved column is named on the page, so which product produced a
figure is never in doubt. Neither `GPP` nor `RECO` is measured — both are
partitioned out of the net flux — so both take their quality flag from the `NEE`
they came from.

## Uncertainty

Every flux figure carries an interval, aggregated from the uncertainty columns the file publishes:

```
Net CO₂ exchange, total   -306.62 g C m⁻²
  ± 21.24 g C m⁻² (random and u* threshold) · 1st of 21 such months (1st = largest net uptake)
```

How a half-hourly uncertainty becomes a monthly one depends on whether the error is independent
between records or one choice held across all of them, and the difference is not small: on the
CH-Oe2 record the two treatments of the same u\* uncertainty differ by a factor of fourteen at
annual scale. So the random term is combined in quadrature and shrinks with the length of the span,
while the u\* term is carried as an ensemble — each threshold version aggregated over the span, then
the spread of the totals — and does not shrink.

`*_JOINTUNC` is deliberately not used. It combines both terms already, but only per record, so
aggregating it puts the systematic half through a √n that does not apply to it and reports a median
year as ±9 g C m⁻² where the ensemble says ±121. `LE_CORR_JOINTUNC` and `H_CORR_JOINTUNC` are empty
in a real FULLSET file in any case.

What each interval covers is named beside it, because a ± covering the threshold choice is a much
larger claim than one covering only the random term: `NEE` gets both, `GPP` and `RECO` the u\* term
from their `_SE` columns, `LE` and `H` the random term alone.

`NEE` is also the one variable ranked from the negative end, since the sign convention makes the
most negative month the largest uptake — so rank 1 is the record sink, and the page says so.

## Coverage: the gap-filled values are used, and what they rest on is stated

A span carries two coverage figures. **Availability** is what share of it carries
a value at all — for a gap-filled product, 100 % wherever the product covers the
span. **Measurement** is what share came from the instrument rather than the
model.

Every statistic here is gated on **availability**. Normals, ranks, anomalies,
badges and trends are computed wherever the product covers the span, whatever
share of it was measured. `TA_F`, `NEE_VUT_REF` and `GPP_NT_VUT_REF` are the
series the community publishes and analyses, and a page that quietly declined to
use them would describe a sparser record than the file is of.

The measured share gates nothing. It **warns**: below its variable's line a span
is hatched on the grid, carries the sparse badge, is marked in the month panel and
is counted in the build's output.

```
warning: NEE is under 20 % measured in 16 of 252 months (lowest 2 % in December
2006); the gap-filled values are used and those months are marked on the grid
```

Meteorology warns under 50 %, the turbulent fluxes under 20 % — half of every
eddy covariance record is night that u\* filtering rejects by design, so warning a
flux at the meteorological line would flag every month of every flux record ever
produced.

**What this costs is stated rather than hidden.** A span measured less carries
more model than one measured more, so where the measured share itself trends
through a record — at CH-Oe2 it rises from about 35 % to 50 % — part of a slope
may be that trend rather than the ecosystem. The page says so beside the trends
and names which variables lean hardest on the filling.

A variable with no QC column is a different case and still gated: `RH` has no
gap-filling, so its gaps are genuinely missing, and its trend is withheld.

## Example

`examples/` holds a twenty-one-year six-variable extract of the CH-LAE meteo
record and a script that builds two atlases from it:

```bash
uv run python examples/build_lae_meteo_atlas.py --open
```

It builds one atlas of all six variables and one of air temperature alone — 20
metrics against 7, 37 badge types against 16 — which is the selection behaviour
in one run.

`examples/build_oe2_flux_atlas.py` is the companion, and the opposite case: a
real FLUXNET FULLSET record, whose columns the registry finds without being told
anything, and which carries the fluxes.

```bash
uv run python examples/build_oe2_flux_atlas.py --open
uv run python examples/build_oe2_flux_atlas.py --out /somewhere/outside/the/repo
```

It prints what the file can supply, then builds **one** page from all of it — 28
metrics, 43 badge types. `--vars` narrows what goes on that page; it stays one
file. The FULLSET file it defaults to is 552 MB and **not committed**; `--input`
points it at any FLUXNET-standardized half-hourly file.

## Tests

```bash
uv run pytest
```

Most tests run on synthetic data generated in `tests/conftest.py`, so the suite
passes without the example extract. The tests that read it skip when it is
absent.

## Origin

The page is the site-independent generalization of the calendar explorer built
for the [CH-LAE flux product](https://github.com/holukas/dataset_ch-lae_flux_product).

## License

GPL-3.0
