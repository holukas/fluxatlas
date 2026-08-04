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

# Quality-flag conventions. In FLUXNET the `_QC` column beside a gap-filled variable is 0 where the
# record is measured and 1..3 for successively poorer fill; anything above 0 is therefore modelled.
# A file without a QC column is read as measured wherever it is not missing, which is the most a
# reader can conclude from it.
MEASURED_QC_CODES = frozenset({0})

QC_LEGEND = {0: "measured", 1: "good-quality fill", 2: "medium-quality fill",
             3: "poor-quality fill"}


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

        self.extremes = dict(high="highest", low="lowest", low_halfhour=True, low_day=True)
        self.extremes.update(cfg.get("extremes", {}))

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


def known():
    """The canonical keys the registry describes, in registry order."""
    return list(VARIABLES)


def make(key):
    """One `Variable`, by canonical key."""
    if key not in VARIABLES:
        raise KeyError(f"unknown variable {key!r}; known keys: {', '.join(VARIABLES)}")
    return Variable(key, VARIABLES[key])
