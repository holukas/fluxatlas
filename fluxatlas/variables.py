"""What the atlas knows about each variable, and how it finds it in a FLUXNET file.

One registry, keyed by a **canonical key** (`TA`, `PREC`, `SW_IN`, ...). The canonical key is what
the metrics, badges and day tests are written against; the FLUXNET column that supplies it is
resolved per file from `columns`, in the order given.

Why a candidate list rather than one name
-----------------------------------------
"FLUXNET-standardized" names more than one convention. A FLUXNET2015/ONEFlux FULLSET file carries
`TA_F` with a `TA_F_QC` beside it; EddyPro's own FLUXNET output carries `TA_EP` and no QC column at
all; a biomet-fed file carries the position-indexed `TA_1_1_1`. All three are air temperature, and
the atlas should read whichever is present rather than make the caller rename columns.

Units are part of that resolution. The same quantity is published in different units by different
producers - vapour pressure deficit is hPa in FULLSET and Pa in EddyPro output - so every candidate
carries the factor that converts it into the canonical unit named by `units`. `limits` is then
checked against the converted series, which turns a wrong factor into a build error naming the
column instead of an atlas whose evaporative stress days are all or nothing.

Adding a variable
-----------------
Add an entry here. To be colourable on the grid it also needs a metric in `calendar.METRICS`; to
earn badges it needs rules in `calendar.BADGES`. Neither is required - a variable with neither is
still read, still shown in the day panel and still counted in coverage.
"""

from __future__ import annotations

from collections import namedtuple
from functools import lru_cache

# Coverage: what gates a statistic, and what only flags it
# ---------------------------------------------------------------------------------------------
# A span carries two coverage figures and they answer different questions.
#
# - **available** - what share of the span carries a value at all. For a gap-filled product this is
#   100 % wherever the product covers the span, and 0 % where it does not.
# - **measured** - what share of it came from the instrument rather than from the gap-filling model.
#
# Every statistical gate reads **availability**. A calendar-month normal, a rank, an anomaly, a
# badge and a trend are all computed wherever the product covers the span, whatever share of it was
# measured. That is a deliberate decision and it is what the gap-filled columns are for: `TA_F`,
# `NEE_VUT_REF`, `GPP_NT_VUT_REF` and the rest are the series the community publishes and analyses,
# and a page that silently declined to use them would be describing a different, sparser record than
# the one the file is of.
#
# The measured share gates nothing. It **warns**: below `warn` the span is hatched on the grid, it
# carries the sparse badge, and the build prints how many such spans each variable has. The figure
# is used either way, and the reader is told what it rests on.
#
# `badge` and `normal` are the same 90 % today and are kept apart because they gate different claims
# and a site may want them apart.
Coverage = namedtuple("Coverage", "badge normal warn")

# Meteorology is measured nearly continuously when it is measured at all - on the CH-Oe2 record the
# median month is 100 % measured for air temperature and 99.8 % for shortwave - so a month that has
# fallen under half measured is a genuine outage and worth flagging.
COVERAGE_DEFAULT = Coverage(badge=90.0, normal=90.0, warn=50.0)

# A turbulent flux cannot reach that, and not because anything failed. Half of every record is night
# and u* filtering rejects the calm nights on principle, so a half-hourly NEE that is 40-50 %
# measured is a *good* one: on CH-Oe2 the median month is 43.7 % measured and the best month in
# twenty-one years reaches 68.1 %. Warning at the meteorological line would flag every month of
# every flux record ever produced, which is a warning that says nothing.
#
# 20 % is set where a month stops being a thin measurement and becomes very largely model. On the
# CH-Oe2 record that is 24 of 252 months rather than all of them.
FLUX_COVERAGE = Coverage(badge=90.0, normal=90.0, warn=20.0)

# Which group a variable belongs to. The page reads this: the month panel lists the meteorology
# first and then breaks to a row of fluxes in their own colour, because the two are measured
# differently, held to different warning lines, and read differently - a reader scanning for the
# carbon balance should not have to pick it out of the thermometers.
METEOROLOGY = "meteorology"
FLUX = "flux"

# Uncertainty, and why the aggregation kind matters more than the column
# ---------------------------------------------------------------------------------------------
# A FULLSET file publishes uncertainty per half-hour, and the page states figures per month and per
# year. How a half-hourly uncertainty becomes a monthly one depends entirely on whether the error
# is independent between records or driven by one choice held across all of them, and getting that
# wrong is not a rounding difference: on the CH-Oe2 record the two treatments of the same u*
# uncertainty differ by a factor of fourteen at annual scale.
#
# - `QUADRATURE` - independent per-record error. sqrt(sum of squares); shrinks as sqrt(n), so it
#   becomes small at monthly scale and negligible at annual. This is the random uncertainty.
# - `SYSTEMATIC` - a per-record figure that reflects one choice applied to the whole span. Summed
#   linearly, so it does not shrink. Used for the `_SE` columns, which are the spread across the
#   u* percentile versions: the threshold is held for the year, so its effect is correlated across
#   every record in it.
# - `ENSEMBLE` - the members themselves, one column each. Each member is aggregated over the span
#   and half the spread of the totals is taken. This is the only correct treatment of a threshold
#   choice, and it is what NEE gets, because the file publishes the members.
#
# Components combine in quadrature into the figure the page shows. Where a flux has only some of
# them - `LE` and `H` publish no u* term at all, and their `*_CORR_JOINTUNC` columns are empty in a
# real file - the page says which components the interval covers rather than implying it is total.
QUADRATURE = "quadrature"
SYSTEMATIC = "systematic"
ENSEMBLE = "ensemble"

# The u* percentile versions used as the ensemble. The 5th and 95th are left out: they are the
# tails of the threshold distribution rather than a plausible central range, and including them
# widens every interval by about half again.
USTAR_PERCENTILES = ("16", "25", "50", "75", "84")

# Quality-flag conventions. In FLUXNET the `_QC` column beside a gap-filled variable is 0 where the
# record is measured and 1..3 for successively poorer fill; anything above 0 is therefore modelled.
# A file without a QC column is read as measured wherever it is not missing, which is the most a
# reader can conclude from it.
MEASURED_QC_CODES = frozenset({0})

QC_LEGEND = {0: "measured", 1: "good-quality fill", 2: "medium-quality fill",
             3: "poor-quality fill"}

# Half-hourly CO2 fluxes are published in µmol CO2 m-2 s-1 and reported in g C m-2. One half-hour
# at 1 µmol m-2 s-1 is 1e-6 mol * 1800 s * 12.011 g/mol of carbon, so a summed month arrives in the
# unit the figure is normally quoted in rather than as a mean of an instantaneous rate.
UMOL_TO_GC = 1e-6 * 1800.0 * 12.011   # 0.0216198 g C m-2 per half-hour per µmol m-2 s-1


VARIABLES = {

    "TA": dict(
        title="Air temperature",
        short="Air temperature",
        units="°C",
        columns=[("TA_F", 1.0), ("TA_F_MDS", 1.0), ("TA", 1.0), ("TA_EP", 1.0),
                 ("TA_1_1_1", 1.0), ("TA_ERA", 1.0)],
        qc=["TA_F_QC", "TA_F_MDS_QC", "TA_QC"],
        limits=(-60.0, 60.0),
        agg="mean",
        daily_stats=("min", "mean", "max"),
        ship=("min", "mean", "max"),
        digits=1,
        hourly=True,
        scale=10,
        about="Air temperature. The variable most of the calendar's structure is built on: the "
              "growing season, the frost boundaries and the degree-day sum are all taken from it.",
        index_groups=[
            dict(title="Cold indices", ramp="cold",
                 sub="Frost days have a daily minimum below 0 {units}; ice days a daily maximum "
                     "below it.",
                 items=[dict(key="frost", label="frost days (min < 0 {units})", stat="min",
                             op="lt", value=0.0),
                        dict(key="ice", label="ice days (max < 0 {units})", stat="max",
                             op="lt", value=0.0)]),
            dict(title="Warm indices", ramp="warm",
                 sub="Summer days reach 25 {units}, hot days 30 {units}, and a tropical night "
                     "stays above 20 {units}.",
                 items=[dict(key="summer", label="summer days (max ≥ 25 {units})",
                             stat="max", op="ge", value=25.0),
                        dict(key="hot", label="hot days (max ≥ 30 {units})", stat="max",
                             op="ge", value=30.0),
                        dict(key="tropical", label="tropical nights (min ≥ 20 {units})",
                             stat="min", op="ge", value=20.0)]),
        ],
        growing_season=5.0,
        extremes=dict(high="warmest", low="coldest"),
    ),

    "PREC": dict(
        title="Precipitation",
        short="Precipitation",
        units="mm",
        # FLUXNET names precipitation `P`; the canonical key stays `PREC` because that is what the
        # metrics, badges and page are written against.
        columns=[("P_F", 1.0), ("P", 1.0), ("P_1_1_1", 1.0), ("PREC", 1.0)],
        qc=["P_F_QC", "P_QC"],
        limits=(0.0, 200.0),
        agg="sum",
        daily_stats=("sum",),
        ship=("sum", "max"),
        digits=1,
        hourly=True,
        scale=10,
        about="Precipitation as a per-record total. This variable sums rather than averages: a "
              "monthly figure is a total, and a record with no measurement contributes nothing to "
              "it rather than being treated as zero.",
        index_groups=[
            dict(title="Wet-day counts", ramp="cold",
                 sub="Days reaching 1 {units} and 10 {units} of total precipitation.",
                 items=[dict(key="wet", label="wet days (≥ 1 {units})", stat="sum",
                             op="ge", value=1.0),
                        dict(key="heavy", label="heavy days (≥ 10 {units})", stat="sum",
                             op="ge", value=10.0)]),
        ],
        # Most half-hours and many whole days record no rain at all, so neither low end is a
        # statistic - it is a tie across the record broken by whichever day came first.
        extremes=dict(high="wettest", low="driest", low_halfhour=False, low_day=False),
    ),

    "SW_IN": dict(
        title="Incoming shortwave radiation",
        short="Shortwave in",
        units="W m⁻²",
        columns=[("SW_IN_F", 1.0), ("SW_IN_F_MDS", 1.0), ("SW_IN", 1.0), ("SW_IN_1_1_1", 1.0),
                 ("SW_IN_ERA", 1.0)],
        qc=["SW_IN_F_QC", "SW_IN_F_MDS_QC", "SW_IN_QC"],
        limits=(-50.0, 1500.0),
        agg="mean",
        daily_stats=("mean", "max"),
        ship=("mean", "max"),
        digits=0,
        hourly=True,
        scale=1,
        about="Incoming shortwave radiation. The clear and overcast day tests are taken against "
              "the percentiles for the date rather than a fixed threshold, so a bright winter day "
              "counts as one.",
        extremes=dict(high="brightest", low="dullest", low_halfhour=False, low_day=True),
    ),

    "VPD": dict(
        title="Vapour pressure deficit",
        short="Vapour pressure deficit",
        units="kPa",
        # FULLSET publishes VPD in hPa and EddyPro's FLUXNET output in Pa; both are converted onto
        # the kPa the evaporative-stress thresholds are stated in.
        columns=[("VPD_F", 0.1), ("VPD_F_MDS", 0.1), ("VPD_EP", 0.001), ("VPD", 0.1),
                 ("VPD_ERA", 0.1)],
        qc=["VPD_F_QC", "VPD_F_MDS_QC", "VPD_QC"],
        limits=(0.0, 12.0),
        agg="mean",
        daily_stats=("mean", "max"),
        ship=("mean", "max"),
        digits=2,
        hourly=False,
        scale=100,
        about="Vapour pressure deficit, the atmosphere's evaporative demand. Physically the "
              "combination of temperature and humidity that closes stomata, which is why it is an "
              "axis of the composite and relative humidity is not.",
        extremes=dict(high="driest air", low="dampest air", low_halfhour=False),
    ),

    "RH": dict(
        title="Relative humidity",
        short="Relative humidity",
        units="%",
        columns=[("RH", 1.0), ("RH_EP", 1.0), ("RH_1_1_1", 1.0)],
        qc=["RH_QC"],
        limits=(0.0, 100.0),
        agg="mean",
        daily_stats=("min", "mean", "max"),
        ship=("min", "mean"),
        digits=0,
        hourly=False,
        scale=1,
        about="Relative humidity. Kept for the saturation test - a mean of 95 % or more is the "
              "tower inside cloud or fog - rather than as an axis of the composite, where vapour "
              "pressure deficit carries the same information in a physically meaningful form.",
        extremes=dict(high="dampest", low="driest"),
    ),

    "SWC": dict(
        title="Soil water content",
        short="Soil water",
        units="%",
        columns=[("SWC_F_MDS_1", 1.0), ("SWC_1", 1.0), ("SWC_1_1_1", 1.0), ("SWC", 1.0)],
        qc=["SWC_F_MDS_1_QC", "SWC_QC"],
        limits=(0.0, 100.0),
        agg="mean",
        daily_stats=("min", "mean", "max"),
        ship=("mean",),
        digits=1,
        hourly=False,
        scale=10,
        about="Volumetric soil water content of the shallowest reported layer. The limb of a "
              "drought that the atmosphere's demand acts on, and the slowest of the axes to "
              "recover.",
        extremes=dict(high="wettest soil", low="driest soil"),
    ),

    # ------------------------------------------------------------------------------------------
    # The carbon fluxes.
    #
    # All three sum rather than average. A monthly mean in µmol m-2 s-1 is a mean of an
    # instantaneous rate and comparable to nothing that gets published; the total in g C m-2 is the
    # figure a reader already has a sense of, and it makes the calendar tile answer "how much
    # carbon" rather than "how fast, on average". The consequence is the one precipitation already
    # has: the sum is gap-preserving, so a month with gaps under-reports and its measured share is
    # worth reading beside it.
    #
    # The u* variant resolved first is VUT_REF, the FLUXNET2015/ONEFlux reference selection under a
    # per-year threshold. Over a record of decades that is the one that does not impose a single
    # year's turbulence criterion on all the others; CUT_REF follows for files that carry only it.
    # ------------------------------------------------------------------------------------------

    "NEE": dict(
        title="Net ecosystem exchange",
        short="Net CO₂ exchange",
        units="g C m⁻²",
        columns=[("NEE_VUT_REF", UMOL_TO_GC), ("NEE_CUT_REF", UMOL_TO_GC),
                 ("NEE_VUT_USTAR50", UMOL_TO_GC), ("NEE_CUT_USTAR50", UMOL_TO_GC),
                 ("NEE_F", UMOL_TO_GC), ("NEE", UMOL_TO_GC), ("NEE_EP", UMOL_TO_GC)],
        qc=["NEE_VUT_REF_QC", "NEE_CUT_REF_QC", "NEE_VUT_USTAR50_QC", "NEE_CUT_USTAR50_QC",
            "NEE_QC"],
        # Half-hourly, after the ×0.0216 conversion: ±4 g C m-2 is ±185 µmol m-2 s-1, far outside
        # anything an ecosystem sustains and comfortably inside what a missing conversion would
        # produce, which is what this check is for.
        limits=(-4.0, 4.0),
        coverage=FLUX_COVERAGE,
        family=FLUX,
        agg="sum",
        daily_stats=("sum",),
        ship=("sum",),
        digits=2,
        hourly=True,
        scale=1000,
        about="Net ecosystem exchange of CO₂, signed by the micrometeorological convention: "
              "negative is uptake by the ecosystem, positive is release to the atmosphere. The "
              "monthly figure is the total, so a month reads directly as the carbon the site "
              "gained or lost.",
        index_groups=[
            dict(title="Carbon balance", ramp="cold",
                 sub="A sink day closes with a negative total: the ecosystem took up more carbon "
                     "than it released over the twenty-four hours.",
                 items=[dict(key="sink", label="sink days (daily total < 0 {units})",
                             stat="sum", op="lt", value=0.0)]),
        ],
        extremes=dict(high="largest net release", low="largest net uptake"),
        # The one variable on the page whose informative extreme is the negative one. Ranked from
        # the top, the biggest carbon sink of a calendar month would come out last of its month,
        # which is the opposite of what a reader takes "1st of 21" to mean.
        rank_first="low",
        # The one variable whose zero means something, and the words for either side of it. A
        # figure of "+66" and a departure of "+75" say nothing to a reader who is not already
        # carrying the sign convention, so the page writes the direction out wherever it prints
        # one: "net release", "less uptake than normal". Any later variable whose sign is
        # meaningful gets the same treatment by adding this field rather than by naming NEE in the
        # renderer.
        sign=dict(low="uptake", high="release", zero="in balance"),
        # The only flux the file gives both halves of. `*_JOINTUNC` combines these two already, but
        # only per record - aggregating it would put the systematic half through a sqrt(n) that
        # does not apply to it, and report a median year as +/- 9 g C m-2 where the ensemble says
        # +/- 121. So the two are carried apart and combined at the scale the page states.
        uncertainty=[
            dict(kind=QUADRATURE, label="random",
                 columns=["NEE_VUT_REF_RANDUNC", "NEE_CUT_REF_RANDUNC",
                          "NEE_VUT_USTAR50_RANDUNC", "NEE_CUT_USTAR50_RANDUNC"]),
            dict(kind=ENSEMBLE, label="u* threshold",
                 members=[[f"NEE_VUT_{p}" for p in USTAR_PERCENTILES],
                          [f"NEE_CUT_{p}" for p in USTAR_PERCENTILES]]),
        ],
    ),

    # GPP and RECO are partitioning products, not measurements: neither is observed, both are
    # derived from the gap-filled net flux. So neither carries a QC column of its own, and the
    # honest statement about how much of a month is measured is the one that applies to the NEE it
    # was partitioned from - which is what the `qc` list below names. Nighttime (Reichstein)
    # partitioning resolves first, daytime (Lasslop) second; the resolved column travels onto the
    # page, so a reader can always see which method produced the figures.
    "GPP": dict(
        title="Gross primary productivity",
        short="Gross primary productivity",
        units="g C m⁻²",
        columns=[("GPP_NT_VUT_REF", UMOL_TO_GC), ("GPP_DT_VUT_REF", UMOL_TO_GC),
                 ("GPP_NT_CUT_REF", UMOL_TO_GC), ("GPP_DT_CUT_REF", UMOL_TO_GC),
                 ("GPP_NT_VUT_USTAR50", UMOL_TO_GC), ("GPP_DT_VUT_USTAR50", UMOL_TO_GC),
                 ("GPP_F", UMOL_TO_GC), ("GPP", UMOL_TO_GC)],
        qc=["NEE_VUT_REF_QC", "NEE_CUT_REF_QC", "NEE_VUT_USTAR50_QC", "NEE_QC"],
        # Gross uptake is positive by construction, but the nighttime partitioning returns negative
        # values wherever its respiration model overshoots the measured net flux - on the CH-Oe2
        # record `GPP_NT_VUT_REF` reaches -49 µmol m-2 s-1, against a `GPP_DT_VUT_REF` that never
        # goes below zero. So the low end is open rather than clipped, and the bound is the same
        # one the net flux uses.
        limits=(-4.0, 4.0),
        coverage=FLUX_COVERAGE,
        family=FLUX,
        agg="sum",
        daily_stats=("sum",),
        ship=("sum",),
        digits=2,
        hourly=False,
        scale=1000,
        about="Gross primary productivity: the carbon fixed by photosynthesis, as a positive "
              "quantity. Not measured but partitioned out of the net flux, so its quality is the "
              "quality of the net flux it came from.",
        extremes=dict(high="most productive", low="least productive", low_halfhour=False),
        # No random term is published for a partitioning product, and no ensemble members either -
        # only `_SE`, the spread across the u* percentile versions. Systematic, so summed linearly:
        # in quadrature it would claim a median year is known to 0.03 %, which no partitioning
        # product is.
        uncertainty=[
            dict(kind=SYSTEMATIC, label="u* threshold",
                 columns=["GPP_NT_VUT_SE", "GPP_DT_VUT_SE", "GPP_NT_CUT_SE", "GPP_DT_CUT_SE"]),
        ],
    ),

    "RECO": dict(
        title="Ecosystem respiration",
        short="Ecosystem respiration",
        units="g C m⁻²",
        columns=[("RECO_NT_VUT_REF", UMOL_TO_GC), ("RECO_DT_VUT_REF", UMOL_TO_GC),
                 ("RECO_NT_CUT_REF", UMOL_TO_GC), ("RECO_DT_CUT_REF", UMOL_TO_GC),
                 ("RECO_NT_VUT_USTAR50", UMOL_TO_GC), ("RECO_DT_VUT_USTAR50", UMOL_TO_GC),
                 ("RECO", UMOL_TO_GC)],
        qc=["NEE_VUT_REF_QC", "NEE_CUT_REF_QC", "NEE_VUT_USTAR50_QC", "NEE_QC"],
        # Respiration is a modelled positive quantity and never approaches the low end; the
        # asymmetry is what records that, rather than a bound the data comes near.
        limits=(-1.0, 4.0),
        coverage=FLUX_COVERAGE,
        family=FLUX,
        agg="sum",
        daily_stats=("sum",),
        ship=("sum",),
        digits=2,
        hourly=False,
        scale=1000,
        about="Ecosystem respiration: the carbon returned by plant and soil respiration, as a "
              "positive quantity. The other half of the partitioned net flux, and the term that "
              "keeps rising through a warm night when photosynthesis has stopped.",
        extremes=dict(high="highest respiration", low="lowest respiration"),
        uncertainty=[
            dict(kind=SYSTEMATIC, label="u* threshold",
                 columns=["RECO_NT_VUT_SE", "RECO_DT_VUT_SE", "RECO_NT_CUT_SE", "RECO_DT_CUT_SE"]),
        ],
    ),

    # ------------------------------------------------------------------------------------------
    # The energy fluxes. Both average rather than sum: W m-2 is a rate, and a monthly mean of it is
    # the quantity the energy balance is stated in. `LE_F_MDS` resolves before `LE_CORR` because
    # the gap-filled series carries a QC column and the energy-balance-corrected one does not, so
    # the measured share stays a statement about data rather than about a correction.
    # ------------------------------------------------------------------------------------------

    "LE": dict(
        title="Latent heat flux",
        short="Latent heat",
        units="W m⁻²",
        columns=[("LE_F_MDS", 1.0), ("LE_CORR", 1.0), ("LE_F", 1.0), ("LE", 1.0), ("LE_EP", 1.0)],
        qc=["LE_F_MDS_QC", "LE_QC"],
        # Half-hourly energy fluxes run wider than their daily means suggest: on the CH-Oe2 record
        # `LE_F_MDS` spans -281 to 982 W m-2 and `H_F_MDS` -300 to 988. The bounds are set outside
        # that rather than around it, because this check exists to catch a column that is not the
        # flux at all, not to filter the flux.
        limits=(-500.0, 1200.0),
        coverage=FLUX_COVERAGE,
        family=FLUX,
        agg="mean",
        daily_stats=("mean", "max"),
        ship=("mean", "max"),
        digits=0,
        hourly=True,
        scale=10,
        about="Latent heat flux, the energy carried away as water vapour. The evaporative half of "
              "the surface energy balance, and the term that collapses when the soil runs dry "
              "while the atmosphere's demand does not.",
        extremes=dict(high="strongest evaporation", low="weakest evaporation"),
        # `LE_CORR_JOINTUNC` would be the one to want, and it is -9999 in every record of a real
        # CH-Oe2 file. The random term is what the file actually carries, so that is what is shown,
        # labelled as the random term rather than as a total.
        uncertainty=[
            dict(kind=QUADRATURE, label="random", columns=["LE_RANDUNC"]),
        ],
    ),

    "H": dict(
        title="Sensible heat flux",
        short="Sensible heat",
        units="W m⁻²",
        columns=[("H_F_MDS", 1.0), ("H_CORR", 1.0), ("H_F", 1.0), ("H", 1.0), ("H_EP", 1.0)],
        qc=["H_F_MDS_QC", "H_QC"],
        limits=(-500.0, 1200.0),
        coverage=FLUX_COVERAGE,
        family=FLUX,
        agg="mean",
        daily_stats=("mean", "max"),
        ship=("mean", "max"),
        digits=0,
        hourly=True,
        scale=10,
        about="Sensible heat flux, the energy carried away as warm air. It takes over from the "
              "latent flux as soil water is exhausted, which is why the two are worth reading "
              "against each other rather than on their own.",
        extremes=dict(high="strongest heating", low="strongest cooling"),
        uncertainty=[
            dict(kind=QUADRATURE, label="random", columns=["H_RANDUNC"]),
        ],
    ),
}


class Variable:
    """A registry entry with its defaults filled in, so the rest of the package reads plain fields.

    `column`, `factor`, `qc_column`, `first_year` and `last_year` are not registry facts - they
    depend on the file - and are attached by the reader once it has resolved them.
    """

    def __init__(self, key, cfg):
        self.key = key
        self.title = cfg["title"]
        self.short = cfg.get("short", cfg["title"])
        self.units = cfg["units"]
        self.candidates = list(cfg["columns"])
        self.qc_candidates = list(cfg.get("qc", []))
        self.limits = cfg["limits"]
        self.about = cfg["about"]

        self.agg = cfg.get("agg", "mean")
        self.daily_stats = tuple(cfg.get("daily_stats", ("min", "mean", "max")))
        self.ship = tuple(cfg.get("ship", self.daily_stats))
        self.digits = cfg.get("digits", 2)
        self.hourly = cfg.get("hourly", False)
        self.scale = cfg.get("scale", 1)
        self.index_groups = cfg.get("index_groups", [])
        self.growing_season = cfg.get("growing_season")
        self.measured_codes = MEASURED_QC_CODES
        self.coverage = coverage(key)
        self.family = family(key)

        self.extremes = dict(high="highest", low="lowest", low_halfhour=True, low_day=True)
        self.extremes.update(cfg.get("extremes", {}))

        # Which end of the distribution takes rank 1, and the phrase for what that means. The
        # phrase is generated from `extremes` rather than written twice, so a variable cannot end
        # up ranked one way and described the other.
        self.rank_first = cfg.get("rank_first", "high")
        assert self.rank_first in ("high", "low"), f"{key}: rank_first must be 'high' or 'low'"
        self.rank_note = self.extremes["low" if self.rank_first == "low" else "high"]

        # The words for either side of zero, where zero means something. None for every variable
        # whose sign carries no information, which is all of them but the net exchange.
        self.sign = cfg.get("sign")

        # `agg` is the statistic a month is summarised by; `daily_agg` the one a day is.
        self.daily_agg = "sum" if self.agg == "sum" else "mean"
        for needed in (self.daily_agg, "min", "max"):
            if needed not in self.daily_stats:
                self.daily_stats = self.daily_stats + (needed,)

        # A threshold-day group is drawn with an ordinal ramp of one hue, and the ramps hold two
        # (cold) and three (warm) validated steps. Past that there is no further step to give an
        # index, and generating one would put two indistinguishable hues on the same axis.
        ramp_steps = dict(cold=2, warm=3)
        for group in self.index_groups:
            limit = ramp_steps[group["ramp"]]
            assert len(group["items"]) <= limit, (
                f"{key}: index group {group['title']!r} has {len(group['items'])} indices but the "
                f"{group['ramp']} ramp has {limit} steps - split the group or add a ramp")
        for item in (i for g in self.index_groups for i in g["items"]):
            assert item["stat"] in self.daily_stats, (
                f"{key}: index {item['key']!r} needs the daily {item['stat']}, which is not in "
                f"daily_stats {self.daily_stats}")

        # Filled in by the reader.
        self.uncertainty_note = None
        self.column = None
        self.factor = 1.0
        self.qc_column = None
        self.source = None
        self.first_year = None
        self.last_year = None

    @property
    def fill_flag(self):
        """The QC column, under the name the ported calendar layer asks for it by."""
        return self.qc_column

    def fmt(self, text):
        """Registry text carries `{units}` so a threshold never states the wrong one."""
        return None if text is None else text.format(units=self.units)

    def __repr__(self):
        return f"<Variable {self.key} from {self.column!r} [{self.units}]>"


def uncertainty(key, columns):
    """The uncertainty components this file can supply for `key`, with concrete column names.

    Answered against column *names*, like everything else the reader resolves, so it costs nothing
    before the data is read. A component whose columns are absent is dropped rather than faked, and
    a variable that ends up with no components simply carries no interval - which is the honest
    outcome for a file that does not publish one.
    """
    out = []
    for spec in VARIABLES.get(key, {}).get("uncertainty", []):
        if spec["kind"] == ENSEMBLE:
            members = next((m for m in spec["members"] if all(c in columns for c in m)), None)
            if members:
                out.append(dict(kind=ENSEMBLE, label=spec["label"], columns=list(members)))
            continue
        column = next((c for c in spec["columns"] if c in columns), None)
        if column:
            out.append(dict(kind=spec["kind"], label=spec["label"], columns=[column]))
    return out


def uncertainty_note(components):
    """What an interval built from these components covers, for the page to state.

    A `+/-` that covers only the random term is a different claim from one that covers the
    threshold choice as well, and the difference is an order of magnitude. The page names the
    components rather than letting a reader assume the interval is total.
    """
    if not components:
        return None
    return " and ".join(c["label"] for c in components)


@lru_cache(maxsize=None)
def rank_first(key):
    """Which end of the distribution takes rank 1: `"high"` or `"low"`."""
    return VARIABLES.get(key, {}).get("rank_first", "high")


@lru_cache(maxsize=None)
def family(key):
    """Which group a variable belongs to: `METEOROLOGY` or `FLUX`."""
    return VARIABLES.get(key, {}).get("family", METEOROLOGY)


@lru_cache(maxsize=None)
def coverage(key):
    """The measured-share thresholds this variable's statistics are gated on.

    Answered from the registry alone, without building a `Variable`, because the builder asks it
    once per variable per month and the answer never changes. An unknown key gets the default
    rather than an error: the caller may be asking about a column that is not in the registry at
    all, and the meteorological threshold is the conservative answer.
    """
    return Coverage(*VARIABLES.get(key, {}).get("coverage", COVERAGE_DEFAULT))


def known():
    """The canonical keys the registry describes, in registry order."""
    return list(VARIABLES)


def make(key):
    """One `Variable`, by canonical key."""
    if key not in VARIABLES:
        raise KeyError(f"unknown variable {key!r}; known keys: {', '.join(VARIABLES)}")
    return Variable(key, VARIABLES[key])
