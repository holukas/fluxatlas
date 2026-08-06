"""Build the payload behind an atlas page, and render it.

The per-variable dashboards in this folder answer "what does this variable do over twenty years".
This page answers the other question: "what happened in *that* month". It puts every month of every
year on one grid, marks each of them with the notable things that occurred in it, and lets a reader
open a month and walk it day by day.

Three levels, one page
----------------------
1. **The grid.** One tile per month, twenty-one years by twelve months, coloured by whichever
   metric is selected and carrying badges for what was remarkable about that month. Each tile can
   also show its own days as a micro-strip, so a heat wave is visible as a streak before anything
   is clicked. It is read down its columns as well as across its rows: a figure beside each year, a
   figure under each calendar month, the trend of that column across the record, and the record's
   own figure where the two margins meet. The same grid can be drawn at three resolutions - months,
   seasons, or every day of the record as one raster, which is the only one of the three that does
   not cut a spell in half at a boundary.
2. **The month.** Its statistics against the calendar-month normal, its rank among the same month
   of every other year, its badges spelled out with the numbers behind them, and then the month
   itself from four directions - day by day (temperature against the climatological band, how far
   each day sat from its own normal, precipitation daily and accumulated, soil water against the
   rain that drives it, and radiation, evaporative demand and humidity each over their own normal
   band), the mean day of the month composited from the hourly arrays against the mean day of that
   calendar month across the record, where the month sits among its own years, and a day calendar.
3. **The day.** Every variable's statistics for that day, the flags it set, and - where the hourly
   arrays are included - the diurnal course of radiation, temperature and precipitation, each
   against the mean day of that calendar month.

Why more than one chart per variable
------------------------------------
Each of the month's charts answers a question the others cannot. A monthly anomaly is one number
for thirty days and arises equally from a uniformly mild month and from a cold first week with a
hot last, which is what the daily departure chart separates. A monthly mean cannot say whether a
warm month was warm at night or by day, and the two have different causes - cloud and humidity hold
the night up, radiation lifts the afternoon - which is what the diurnal composite separates. And an
anomaly cannot say whether a departure of one degree is remarkable for that calendar month or
ordinary, because that is a question about the spread of the other years, which the rank strips
draw rather than summarise.

What it computes, and what it must not
--------------------------------------
It aggregates and it compares; it corrects nothing. A value on this page is the value read from the
input file, converted to the canonical unit and nothing else. The variable definitions and the
threshold-day definitions come from `fluxatlas.variables`, which is the one place a "hot day" is
defined.

Two rules keep the badges honest.

- **A badge is a claim about a month, so a month that was not measured cannot make one.** Every
  badge names the variables it reads, and is skipped where the measured share of that variable
  falls below `MIN_BADGE_COVERAGE`. The month view says which badges were suppressed and why,
  rather than showing a tile that silently means "we do not know".
- **A normal is built from the months that can support one.** A calendar-month normal, and every
  anomaly, z-score and rank derived from it, uses only the years whose month is at least
  `NORMAL_MIN_COVERAGE` measured, and is withheld entirely below `MIN_NORMAL_YEARS` of them. A
  sparse month is ranked against nothing and can therefore never be "the driest on record".

The normal is not stationary, and the page says so
--------------------------------------------------
Every anomaly, standard score and rank on this page is taken against the mean of the whole record.
That mean is not a fixed climate: over twenty-one years the record itself moves, so a baseline
drawn from all of it sits between the early years and the late ones, and a late month is measured
against a climate that is partly no longer current. Left unstated, the effect reads as weather.

So the trend is computed rather than assumed, published beside the grid, and never quietly folded
into the comparison. `metric_trends` takes a Theil-Sen slope and Kendall's tau down each column of
the grid and over the record as a whole, using `fluxatlas.stats.trend`, the same estimator the CH-LAE
dashboards draw, so the two cannot disagree about the slope of a series. The foot
row carries the slope under each calendar month, and `epoch_split` states the same thing as two
numbers by halving the record, which is what makes the size of the effect legible next to the
single normal the rest of the page compares against.

The baseline itself is deliberately **not** made selectable. Badges are evaluated in this build
against the whole-record normal; a page that let a reader re-baseline the tiles would show tiles and
badges disagreeing about the same month. One baseline is used for every claim, and the trend is
published as the fact that qualifies it.

Selecting variables
-------------------
Everything below is written against a **selection**. A metric whose variable is not in the build is
dropped, a badge whose `needs` are not all present is withheld and says so, a day test that reads a
variable that is absent is skipped, and the composite counts only the axes it actually has. An
atlas of nothing but air temperature is therefore a smaller page rather than a broken one.

Author: Lukas Hoertnagl (holukas@ethz.ch)
"""

from __future__ import annotations

import base64
import calendar
import importlib.metadata
import json
import re
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import variables as varreg
from ._console import say
from .io import span
from .stats import (
    doy365, growing_season, longest_spell, percentile_domain, r, rank_of, resample_agg, rlist,
    trend,
)

ASSETS = Path(__file__).parent / "assets"

# The page says what made it and who to ask. A built atlas is one file that travels: it is opened
# from a memory stick, mailed to a co-author, put on a share years later. By then nothing around it
# says which tool produced it or where to find the definitions behind its figures, so the page
# carries that itself rather than relying on where it happens to be sitting.
#
# The version comes from the installed distribution, so it cannot drift from what was actually run;
# a source tree that was never installed simply has none to state. The rest is the same fact
# `pyproject.toml` states for the distribution.
AUTHOR = "Lukas Hörtnagl"
AFFILIATION = "Grassland Sciences group, ETH Zürich"
AFFILIATION_URL = "https://gl.ethz.ch/"
REPOSITORY = "https://github.com/holukas/fluxatlas"

try:
    VERSION = importlib.metadata.version("fluxatlas")
except importlib.metadata.PackageNotFoundError:   # a checkout that was never installed
    VERSION = ""

# The coverage thresholds are per variable and live in the registry; these are its defaults, kept
# here under their old names because the page's prose and the payload's metadata state them as the
# general rule. `varreg.coverage(key)` is the authority.
#
# `MIN_BADGE_COVERAGE` and `NORMAL_MIN_COVERAGE` are read against a span's **available** share - has
# the product got a value here - and not against how much of it was measured. `SPARSE_COVERAGE` is
# the one that is still about measurement, and it gates nothing: it marks.
MIN_BADGE_COVERAGE = varreg.COVERAGE_DEFAULT.badge
NORMAL_MIN_COVERAGE = varreg.COVERAGE_DEFAULT.normal
SPARSE_COVERAGE = varreg.COVERAGE_DEFAULT.warn

MIN_NORMAL_YEARS = 8        # qualifying years below which a calendar-month normal is not computed
CLIM_WINDOW = 7             # +/- days around a calendar date that go into its daily normal
TREND_MIN_YEARS = 10        # qualifying years below which a slope is not stated
EPOCH_MIN_YEARS = 5         # complete years each half of the record needs before the two are shown


# ----------------------------------------------------------------------------------------------
# Which products the calendar reads
#
# `ship` names the daily statistics that travel into the page; the rest are computed and dropped.
# `hourly` marks the variables whose diurnal course the day panel draws - each one is roughly half
# a megabyte of the finished file, so the set is deliberately short.
# ----------------------------------------------------------------------------------------------


# Threshold days beyond the ones the dashboards already define. Everything else in `DAY_FLAGS` is
# lifted from the `index_groups` of the shared registry, so the calendar cannot disagree with the
# temperature dashboard about what a hot day is.
EXTRA_INDICES = {
    "PREC": [dict(key="verywet", label="very wet days (≥ 30 {units})", stat="sum",
                  op="ge", value=30.0)],
    # Evaporative demand has no threshold days in the shared registry because the dashboards do not
    # count them, so they are defined here. 2 kPa is where stomatal closure becomes the usual
    # response in temperate broadleaf forest rather than an occasional one; 3 kPa is severe. On
    # this record they fall on 5.4 % and 0.7 % of days, about 20 and 3 days a year.
    "VPD": [dict(key="vpdstress", label="evaporative stress days (daily maximum ≥ 2 {units})",
                 stat="max", op="ge", value=2.0),
            dict(key="vpdsevere", label="severe evaporative stress days (daily maximum ≥ 3 "
                                        "{units})", stat="max", op="ge", value=3.0)],
}

# Day tests that a single threshold on a single statistic cannot express: two conditions at once,
# two variables at once, or a comparison against the day's own normal. Each is a function of the
# daily frame, the measured share and an accessor for the daily normals, returning one boolean per
# day. `var` names the variable a reader should hold responsible for it, which is what decides
# whose coverage gates a badge built on it.
#
# The three record tests are the reason `meas` is passed: a gap-filled value is a model result and
# cannot set a record, so a day that was not substantially measured is not allowed to win one.
DERIVED_FLAGS = [
    dict(key="freezethaw", var="TA",
         label="freeze-thaw days (minimum below 0 {units}, maximum above it)",
         fn=lambda day, meas, nrm: (day["TA"]["min"] < 0) & (day["TA"]["max"] > 0)),
    dict(key="coldprec", var="PREC",
         label="precipitation days that stayed below 1 °C",
         fn=lambda day, meas, nrm: (day["PREC"]["sum"] >= 1.0) & (day["TA"]["max"] < 1.0)),
    dict(key="saturated", var="RH",
         label="days with a mean relative humidity of 95 {units} or more",
         fn=lambda day, meas, nrm: day["RH"]["mean"] >= 95.0),
    dict(key="clear", var="SW_IN",
         label="days brighter than the 90th percentile for the date",
         fn=lambda day, meas, nrm: day["SW_IN"]["mean"] > nrm("SW_IN", "mean", "p90")),
    dict(key="overcast", var="SW_IN",
         label="days duller than the 10th percentile for the date",
         fn=lambda day, meas, nrm: day["SW_IN"]["mean"] < nrm("SW_IN", "mean", "p10")),
    dict(key="recwarm", var="TA", label="warmest occurrence of that calendar date in the record",
         fn=lambda day, meas, nrm: date_record(day["TA"]["max"], meas["TA"], "max")),
    dict(key="reccold", var="TA", label="coldest occurrence of that calendar date in the record",
         fn=lambda day, meas, nrm: date_record(day["TA"]["min"], meas["TA"], "min")),
    dict(key="recwet", var="PREC", label="wettest occurrence of that calendar date in the record",
         fn=lambda day, meas, nrm: date_record(day["PREC"]["sum"], meas["PREC"], "max")),
]

RECORD_DAY_COVERAGE = 90.0  # % of a day measured before it is allowed to set a record for its date

# A name for each day test short enough to sit in a list on a tile. The full label states the
# threshold and is what the day panel and the reference table use; neither fits where nine of them
# appear side by side, and the page fell back to printing the key itself ("recwarm", "coldprec").
# The build asserts the map covers every test that survives, so a test added without a name here
# fails the build instead of shipping its key to a reader.
FLAG_SHORT = {
    "frost": "frost", "ice": "ice", "summer": "summer", "hot": "hot",
    "tropical": "tropical night", "wet": "wet", "heavy": "heavy rain", "verywet": "very wet",
    "freezethaw": "freeze-thaw", "coldprec": "precipitation below 1 °C", "saturated": "in cloud",
    "clear": "clear", "overcast": "overcast", "recwarm": "warmest for its date",
    "reccold": "coldest for its date", "recwet": "wettest for its date",
    "vpdstress": "evaporative stress", "vpdsevere": "severe evaporative stress",
    "sink": "carbon sink",
}


def date_record(series, measured, how):
    """Days that are the extreme occurrence of their own calendar date across the whole record.

    A record for 25 July is decided among the twenty-one 25 Julys, not against the summer, which is
    what makes it a statement a reader can check. Days that are largely gap-filled are excluded from
    the comparison rather than merely from winning it: a modelled value that happens to be high
    would otherwise displace the real record and leave the date looking unremarkable.
    """
    eligible = series.where(measured >= RECORD_DAY_COVERAGE)
    grouped = eligible.groupby([eligible.index.month, eligible.index.day])
    rank = grouped.rank(ascending=(how == "min"), method="min")
    return (rank == 1).fillna(False) & eligible.notna()


def day_flags(variables):
    """The per-day tests, each with the bit it occupies in the day flag word."""
    flags = []
    for key, v in variables.items():
        items = [i for group in v.index_groups for i in group["items"]]
        items = items + EXTRA_INDICES.get(key, [])
        for item in items:
            flags.append(dict(bit=len(flags), var=key, key=item["key"], stat=item["stat"],
                              op=item["op"], value=item["value"], label=v.fmt(item["label"])))
    for item in DERIVED_FLAGS:
        # A derived test may read a variable other than the one it is filed under, so it is only
        # available where every variable it touches is in the build. Rather than inspect the
        # lambda, the caller is given the whole list and skips what raises a KeyError.
        if item["var"] not in variables:
            continue
        flags.append(dict(bit=len(flags), var=item["var"], key=item["key"],
                          fn=item["fn"], label=variables[item["var"]].fmt(item["label"])))
    # The word is read in JavaScript, where a bitwise operation is defined on 32 bits.
    assert len(flags) <= 30, f"{len(flags)} day flags do not fit in one 30-bit word"
    missing = [f["key"] for f in flags if f["key"] not in FLAG_SHORT]
    assert not missing, (f"day test(s) {', '.join(missing)} have no entry in FLAG_SHORT - the page "
                         f"would print the key itself where it lists them on a tile")
    return flags


# ----------------------------------------------------------------------------------------------
# Badges
#
# A badge is one notable thing about one month. `rule` receives the month's statistics and returns
# the sentence that states the evidence, or None where the badge does not apply - so the text a
# reader sees is generated from the same numbers that decided whether to show it at all, and cannot
# describe a month it was not computed on.
#
# `needs` names the variables the rule reads. A badge is only evaluated where all of them are
# present and sufficiently measured, and - unless `needs_normal` is False - where their calendar-
# month normal exists.
#
# `priority` orders the icons on a tile, which shows only the first few. Sparse coverage sorts
# first: it qualifies every other badge on the tile.
# ----------------------------------------------------------------------------------------------

BADGES = [
    # The threshold is the one that variable's own statistics are gated on, not a single number
    # across the build. Measured against the meteorological 90 %, every month of every flux record
    # is sparse - which is not a strict badge but an empty one, since a mark that appears on all
    # 252 tiles distinguishes none of them.
    dict(key="sparse", label="Sparsely measured", group="Data quality", icon="alert",
         tone="warn", priority=0, needs=(), needs_normal=False,
         about="At least one variable in this build is measured over less than the share its own "
               "statistics require - {sparse:.0f} % for meteorology, {flux_sparse:.0f} % for the "
               "turbulent fluxes - so those statistics rest on filled or missing records.",
         rule=lambda s: (
             "Only " + ", ".join(f"{s[k + '_meas']:.0f} % of {k}" for k in s["keys"]
                                 if s[k + "_meas"] is not None
                                 and s[k + "_meas"] < varreg.coverage(k).warn)
             + " is measured in this month; its statistics rest on filled or missing records.")
         if any(s[k + "_meas"] is not None and s[k + "_meas"] < varreg.coverage(k).warn
                for k in s["keys"]) else None),

    dict(key="record_warm", label="Warmest on record", group="Temperature", icon="award",
         tone="warm", priority=1, needs=("TA",),
         about="The warmest occurrence of this calendar month in the record.",
         rule=lambda s: (f"Warmest {s['month_name']} in the record: {s['TA']:.1f} {s['u_TA']} "
                         f"mean, {s['TA_anom']:+.1f} {s['u_TA']} against the normal of "
                         f"{s['TA_n']} years") if s["TA_rank"] == 1 else None),

    dict(key="record_cold", label="Coldest on record", group="Temperature", icon="award",
         tone="cold", priority=1, needs=("TA",),
         about="The coldest occurrence of this calendar month in the record.",
         rule=lambda s: (f"Coldest {s['month_name']} in the record: {s['TA']:.1f} {s['u_TA']} "
                         f"mean, {s['TA_anom']:+.1f} {s['u_TA']} against the normal of "
                         f"{s['TA_n']} years") if s["TA_rank"] == s["TA_n"] else None),

    dict(key="warm", label="Warmer than normal", group="Temperature", icon="arrow-up",
         tone="warm", priority=4, needs=("TA",),
         about="The monthly mean is at least one standard deviation above the calendar-month "
               "normal.",
         rule=lambda s: (f"{s['TA_anom']:+.1f} {s['u_TA']} against the {s['month_name']} normal "
                         f"of {s['TA_norm']:.1f} {s['u_TA']} ({s['TA_z']:+.1f} standard "
                         f"deviations), rank {s['TA_rank']} of {s['TA_n']}")
         if s["TA_z"] >= 1 else None),

    dict(key="cold", label="Colder than normal", group="Temperature", icon="arrow-down",
         tone="cold", priority=4, needs=("TA",),
         about="The monthly mean is at least one standard deviation below the calendar-month "
               "normal.",
         rule=lambda s: (f"{s['TA_anom']:+.1f} {s['u_TA']} against the {s['month_name']} normal "
                         f"of {s['TA_norm']:.1f} {s['u_TA']} ({s['TA_z']:+.1f} standard "
                         f"deviations), rank {s['TA_rank']} of {s['TA_n']}")
         if s["TA_z"] <= -1 else None),

    dict(key="heat", label="Hot days", group="Temperature", icon="flame", tone="warm",
         priority=3, needs=("TA",), needs_normal=False,
         about="At least one day reached 30 °C.",
         rule=lambda s: (f"{s['n_hot']} hot day{'s' if s['n_hot'] > 1 else ''} "
                         f"(daily maximum ≥ 30 {s['u_TA']}), warmest "
                         f"{s['TA_daymax']:.1f} {s['u_TA']}") if s["n_hot"] >= 1 else None),

    dict(key="heat_spell", label="Heat spell", group="Temperature", icon="flames", tone="warm",
         priority=2, needs=("TA",), needs_normal=False,
         about="Three or more consecutive hot days.",
         rule=lambda s: (f"{s['spell_hot']} consecutive hot days, the longest run of this month")
         if s["spell_hot"] >= 3 else None),

    dict(key="tropical", label="Tropical nights", group="Temperature", icon="moon", tone="warm",
         priority=3, needs=("TA",), needs_normal=False,
         about="At least one night stayed above 20 °C.",
         rule=lambda s: (f"{s['n_tropical']} night{'s' if s['n_tropical'] > 1 else ''} with a "
                         f"daily minimum ≥ 20 {s['u_TA']}") if s["n_tropical"] >= 1 else None),

    dict(key="frost", label="Frost days", group="Temperature", icon="snowflake", tone="cold",
         priority=3, needs=("TA",), needs_normal=False,
         about="Five or more days with a daily minimum below freezing.",
         rule=lambda s: (f"{s['n_frost']} frost days (daily minimum < 0 {s['u_TA']}), coldest "
                         f"{s['TA_daymin']:.1f} {s['u_TA']}") if s["n_frost"] >= 5 else None),

    dict(key="ice", label="Ice days", group="Temperature", icon="icicles", tone="cold",
         priority=3, needs=("TA",), needs_normal=False,
         about="At least one day stayed below freezing all day.",
         rule=lambda s: (f"{s['n_ice']} ice day{'s' if s['n_ice'] > 1 else ''} (daily maximum "
                         f"< 0 {s['u_TA']})") if s["n_ice"] >= 1 else None),

    dict(key="record_wet", label="Wettest on record", group="Precipitation", icon="award",
         tone="wet", priority=1, needs=("PREC",),
         about="The wettest occurrence of this calendar month in the record.",
         rule=lambda s: (f"Wettest {s['month_name']} in the record: {s['PREC']:.0f} "
                         f"{s['u_PREC']}, {s['PREC_pctn']:.0f} % of the normal of "
                         f"{s['PREC_norm']:.0f} {s['u_PREC']}") if s["PREC_rank"] == 1 else None),

    dict(key="record_dry", label="Driest on record", group="Precipitation", icon="award",
         tone="dry", priority=1, needs=("PREC",),
         about="The driest occurrence of this calendar month in the record.",
         rule=lambda s: (f"Driest {s['month_name']} in the record: {s['PREC']:.0f} "
                         f"{s['u_PREC']}, {s['PREC_pctn']:.0f} % of the normal of "
                         f"{s['PREC_norm']:.0f} {s['u_PREC']}")
         if s["PREC_rank"] == s["PREC_n"] else None),

    dict(key="wet", label="Wet month", group="Precipitation", icon="droplets", tone="wet",
         priority=4, needs=("PREC",),
         about="The monthly total is at least 150 % of the calendar-month normal.",
         rule=lambda s: (f"{s['PREC']:.0f} {s['u_PREC']}, {s['PREC_pctn']:.0f} % of the "
                         f"{s['month_name']} normal, on {s['n_wet']} wet days")
         if s["PREC_pctn"] >= 150 else None),

    dict(key="dry", label="Dry month", group="Precipitation", icon="droplet-off", tone="dry",
         priority=4, needs=("PREC",),
         about="The monthly total is at most 50 % of the calendar-month normal.",
         rule=lambda s: (f"{s['PREC']:.0f} {s['u_PREC']}, {s['PREC_pctn']:.0f} % of the "
                         f"{s['month_name']} normal, on {s['n_wet']} wet days")
         if s["PREC_pctn"] <= 50 else None),

    dict(key="dry_spell", label="Dry spell", group="Precipitation", icon="calendar-dry",
         tone="dry", priority=2, needs=("PREC",), needs_normal=False,
         about="Fourteen or more consecutive days below 1 mm.",
         rule=lambda s: (f"{s['spell_dry']} consecutive days below 1 {s['u_PREC']}")
         if s["spell_dry"] >= 14 else None),

    # The threshold is a day of 30 mm rather than a count of 10 mm days: at this site three days
    # above 10 mm occur in nearly half of all months, and a badge that common marks nothing.
    dict(key="heavy_rain", label="Heavy rain day", group="Precipitation", icon="cloud-rain",
         tone="wet", priority=3, needs=("PREC",), needs_normal=False,
         about="At least one day reached 30 mm.",
         rule=lambda s: (f"{s['n_verywet']} day{'s' if s['n_verywet'] > 1 else ''} above 30 "
                         f"{s['u_PREC']}, the wettest {s['PREC_daysum']:.0f} {s['u_PREC']}; "
                         f"{s['n_heavy']} days above 10 {s['u_PREC']}")
         if s["n_verywet"] >= 1 else None),

    dict(key="sunny", label="Sunnier than normal", group="Radiation", icon="sun", tone="sun",
         priority=4, needs=("SW_IN",),
         about="Mean incoming shortwave radiation is at least one standard deviation above the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['SW_IN']:.0f} {s['u_SW_IN']} mean, {s['SW_IN_anom']:+.0f} "
                         f"{s['u_SW_IN']} against the {s['month_name']} normal "
                         f"({s['SW_IN_z']:+.1f} standard deviations)")
         if s["SW_IN_z"] >= 1 else None),

    dict(key="dull", label="Duller than normal", group="Radiation", icon="cloud", tone="dull",
         priority=4, needs=("SW_IN",),
         about="Mean incoming shortwave radiation is at least one standard deviation below the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['SW_IN']:.0f} {s['u_SW_IN']} mean, {s['SW_IN_anom']:+.0f} "
                         f"{s['u_SW_IN']} against the {s['month_name']} normal "
                         f"({s['SW_IN_z']:+.1f} standard deviations)")
         if s["SW_IN_z"] <= -1 else None),

    # -- Evaporative demand -------------------------------------------------------------------
    # Vapour pressure deficit is the atmospheric limb of a drought: the demand the air makes on
    # the water a forest still has. It is what closes stomata, so at a flux site it belongs in its
    # own group rather than filed under radiation.
    dict(key="vpd_record", label="Driest air on record", group="Evaporative demand", icon="award",
         tone="dry", priority=1, needs=("VPD",),
         about="The highest mean vapour pressure deficit of this calendar month in the record.",
         rule=lambda s: (f"The driest air of any {s['month_name']} in the record: "
                         f"{s['VPD']:.2f} {s['u_VPD']} mean, {s['VPD_anom']:+.2f} against the "
                         f"normal of {s['VPD_n']} years") if s["VPD_rank"] == 1 else None),

    dict(key="vpd_high", label="High evaporative demand", group="Evaporative demand", icon="gauge",
         tone="dry", priority=4, needs=("VPD",),
         about="Mean vapour pressure deficit is at least one standard deviation above the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['VPD']:.2f} {s['u_VPD']} mean, {s['VPD_anom']:+.2f} "
                         f"{s['u_VPD']} against the {s['month_name']} normal "
                         f"({s['VPD_z']:+.1f} standard deviations)")
         if s["VPD_z"] >= 1 else None),

    dict(key="vpd_low", label="Low evaporative demand", group="Evaporative demand",
         icon="gauge-low", tone="wet", priority=4, needs=("VPD",),
         about="Mean vapour pressure deficit is at least one standard deviation below the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['VPD']:.2f} {s['u_VPD']} mean, {s['VPD_anom']:+.2f} "
                         f"{s['u_VPD']} against the {s['month_name']} normal "
                         f"({s['VPD_z']:+.1f} standard deviations)")
         if s["VPD_z"] <= -1 else None),

    dict(key="vpd_stress", label="Evaporative stress days", group="Evaporative demand",
         icon="evaporation", tone="dry", priority=3, needs=("VPD",), needs_normal=False,
         about="Five or more days whose maximum vapour pressure deficit reached 2 kPa, where "
               "stomata usually begin to close.",
         rule=lambda s: (
             f"{s['n_vpdstress']} days reached 2 {s['u_VPD']}"
             + (f", {s['n_vpdsevere']} of them 3 {s['u_VPD']}" if s["n_vpdsevere"] else "")
             + (f", {s['spell_vpdstress']} of them consecutively"
                if s["spell_vpdstress"] >= 3 else "")
             + f"; the driest air of the month reached {s['VPD_daymax']:.2f} {s['u_VPD']}")
         if s["n_vpdstress"] >= 5 else None),

    # The compound the flux record cares about most: the air demanding water at the moment the
    # soil has none left to give. It is not the same event as hot and dry - it catches the late
    # summers and autumns whose temperature was ordinary and whose rain had merely stopped
    # earlier - so both compounds exist and a month can carry either or both.
    dict(key="vpd_soil", label="Dry air over dry soil", group="Compound", icon="droplet-low",
         tone="dry", priority=1, needs=("VPD", "SWC"), supersedes=("vpd_high", "soil_dry"),
         about="Evaporative demand at least one standard deviation above its calendar-month "
               "normal while soil water is at least one below: the air pulling hardest when "
               "the soil has least to give.",
         rule=lambda s: (
             f"Evaporative demand {s['VPD_z']:+.1f} standard deviations from the "
             f"{s['month_name']} normal while soil water stood {s['SWC_z']:+.1f}, "
             f"{s['SWC_anom']:+.1f} {s['u_SWC']} below normal")
         if (s["VPD_z"] >= 1 and s["SWC_z"] <= -1) else None),

    dict(key="soil_dry", label="Dry soil", group="Soil", icon="soil", tone="dry", priority=3,
         needs=("SWC",),
         about="Mean soil water content is at least one standard deviation below the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['SWC']:.1f} {s['u_SWC']} "
                         f"{s['SWC_anom']:+.1f} {s['u_SWC']} against the "
                         f"{s['month_name']} normal ({s['SWC_z']:+.1f} standard deviations)")
         if s["SWC_z"] <= -1 else None),

    dict(key="soil_wet", label="Wet soil", group="Soil", icon="soil", tone="wet", priority=3,
         needs=("SWC",),
         about="Mean soil water content is at least one standard deviation above the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['SWC']:.1f} {s['u_SWC']} "
                         f"{s['SWC_anom']:+.1f} {s['u_SWC']} against the "
                         f"{s['month_name']} normal ({s['SWC_z']:+.1f} standard deviations)")
         if s["SWC_z"] >= 1 else None),

    # -- The carbon balance ---------------------------------------------------------------------
    # `NEE` is ranked from the negative end (`rank_first="low"` in the registry), because the sign
    # convention makes the most negative month the largest carbon uptake and a reader takes "1st of
    # 21" to mean the most notable one. So rank 1 is the record sink and the last rank the record
    # source - the opposite way round from every other variable on the page, and the reason the
    # registry states the direction rather than leaving it implied.
    dict(key="record_sink", label="Best carbon balance on record", group="Carbon", icon="award",
         tone="grow", priority=1, needs=("NEE",),
         about="The most carbon this site has gained in this calendar month, or where the month is "
               "a source in every year of the record, the least it has lost.",
         rule=lambda s: (
             f"The best carbon balance of any {s['month_name']} in the record: "
             + carbon_phrase(s["NEE"], s["u_NEE"], varreg.make("NEE").sign)
             + f", {abs(s['NEE_anom']):.0f} {s['u_NEE']} "
             + ("more uptake" if s["NEE_norm"] <= 0 else "less release")
             + f" than the normal of {s['NEE_n']} years")
         if s["NEE_rank"] == 1 else None),

    dict(key="record_source", label="Worst carbon balance on record", group="Carbon",
         icon="award", tone="warm", priority=1, needs=("NEE",),
         about="The most carbon this site has lost in this calendar month, or where the month is a "
               "sink in every year of the record, the least it has gained.",
         rule=lambda s: (
             f"The worst carbon balance of any {s['month_name']} in the record: "
             + carbon_phrase(s["NEE"], s["u_NEE"], varreg.make("NEE").sign)
             + f", {abs(s['NEE_anom']):.0f} {s['u_NEE']} "
             + ("more release" if s["NEE_norm"] > 0 else "less uptake")
             + f" than the normal of {s['NEE_n']} years")
         if s["NEE_rank"] == s["NEE_n"] else None),

    dict(key="sink_strong", label="Shifted toward uptake", group="Carbon", icon="arrow-down",
         tone="grow", priority=4, needs=("NEE",),
         about="The net exchange is at least one standard deviation below the calendar-month "
               "normal: more carbon taken up than usual, or less released.",
         rule=lambda s: (carbon_phrase(s["NEE"], s["u_NEE"], varreg.make("NEE").sign)
                         + f", {abs(s['NEE_anom']):.0f} {s['u_NEE']} "
                         f"{'more uptake' if s['NEE_norm'] <= 0 else 'less release'} than the "
                         f"{s['month_name']} normal of {s['NEE_norm']:.0f} {s['u_NEE']} "
                         f"({s['NEE_z']:+.1f} standard deviations), on {s['n_sink']} sink days")
         if s["NEE_z"] <= -1 else None),

    dict(key="sink_weak", label="Shifted toward release", group="Carbon", icon="arrow-up",
         tone="warm", priority=4, needs=("NEE",),
         about="The net exchange is at least one standard deviation above the calendar-month "
               "normal: less carbon taken up than usual, or more released.",
         rule=lambda s: (carbon_phrase(s["NEE"], s["u_NEE"], varreg.make("NEE").sign)
                         + f", {abs(s['NEE_anom']):.0f} {s['u_NEE']} "
                         f"{'less uptake' if s['NEE_norm'] <= 0 else 'more release'} than the "
                         f"{s['month_name']} normal of {s['NEE_norm']:.0f} {s['u_NEE']} "
                         f"({s['NEE_z']:+.1f} standard deviations), on {s['n_sink']} sink days")
         if s["NEE_z"] >= 1 else None),

    dict(key="gpp_high", label="More productive than normal", group="Carbon", icon="sprout",
         tone="grow", priority=3, needs=("GPP",),
         about="Gross primary productivity is at least one standard deviation above the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['GPP']:.0f} {s['u_GPP']} fixed, {s['GPP_anom']:+.0f} "
                         f"{s['u_GPP']} against the {s['month_name']} normal "
                         f"({s['GPP_z']:+.1f} standard deviations)") if s["GPP_z"] >= 1 else None),

    dict(key="gpp_low", label="Less productive than normal", group="Carbon", icon="leaf-fall",
         tone="dull", priority=3, needs=("GPP",),
         about="Gross primary productivity is at least one standard deviation below the "
               "calendar-month normal.",
         rule=lambda s: (f"{s['GPP']:.0f} {s['u_GPP']} fixed, {s['GPP_anom']:+.0f} "
                         f"{s['u_GPP']} against the {s['month_name']} normal "
                         f"({s['GPP_z']:+.1f} standard deviations)") if s["GPP_z"] <= -1 else None),

    # -- Two things at once -------------------------------------------------------------------
    # The compound state, and the reason this page has a Compound group at all: heat and drought
    # arriving together is not the sum of a warm month and a dry one. Warm air raises the demand
    # for water at the moment the supply stops, the soil cannot buffer both, and a forest that
    # closes its stomata stops taking up carbon - which for this site is the whole point. The
    # thresholds are exactly those of the `warm` and `dry` badges, so the compound badge marks
    # their intersection and nothing new has to be defined; `supersedes` then removes the two
    # marginal badges from the month, because three chips for one state is what buried the state
    # in the first place.
    dict(key="hot_dry", label="Hot and dry together", group="Compound", icon="drought",
         tone="dry", priority=1, needs=("TA", "PREC"), supersedes=("warm", "dry"),
         about="The monthly mean is at least one standard deviation above the calendar-month "
               "normal and the total at most half of it. Either alone is ordinary weather; "
               "together they close stomata.",
         rule=lambda s: (
             f"{s['TA_anom']:+.1f} {s['u_TA']} against the {s['month_name']} normal, and only "
             f"{s['PREC_pctn']:.0f} % of its precipitation ({s['PREC']:.0f} {s['u_PREC']} against "
             f"{s['PREC_norm']:.0f})"
             + (f", with soil water {s['SWC_z']:+.1f} standard deviations from normal"
                if s.get("SWC_z") is not None else "")
             + (f" and evaporative demand {s['VPD_z']:+.1f}"
                if s.get("VPD_z") is not None else ""))
         if (s["TA_z"] >= 1 and s["PREC_pctn"] <= 50) else None),

    # -- The year's turning points ----------------------------------------------------------
    # Each is stated against the median date of the same event across the record: a date on its
    # own says nothing, and the departure from the usual date is the whole content.
    dict(key="gs_start", label="Growing season begins", group="Season", icon="sprout",
         tone="grow", priority=2, needs=("TA",), needs_normal=False,
         about="The month in which the growing season began: six consecutive days above 5 °C.",
         rule=lambda s: (
             f"The growing season began on {s['ev_gs_start']['date']}, "
             + (f"{abs(s['ev_gs_start']['delta'])} days "
                f"{'earlier' if s['ev_gs_start']['delta'] < 0 else 'later'} than usual"
                if s["ev_gs_start"]["delta"] else "the usual date")
             + (f", and ran {s['ev_gs_start']['length']} days" if s["ev_gs_start"]["length"]
                else "")) if s["ev_gs_start"] else None),

    dict(key="gs_end", label="Growing season ends", group="Season", icon="leaf-fall",
         tone="grow", priority=2, needs=("TA",), needs_normal=False,
         about="The month in which the growing season ended: six consecutive days below 5 °C "
               "after 1 July.",
         rule=lambda s: (
             f"The growing season ended on {s['ev_gs_end']['date']}, "
             + (f"{abs(s['ev_gs_end']['delta'])} days "
                f"{'earlier' if s['ev_gs_end']['delta'] < 0 else 'later'} than usual"
                if s["ev_gs_end"]["delta"] else "the usual date")) if s["ev_gs_end"] else None),

    dict(key="last_frost", label="Last frost of spring", group="Season", icon="snowflake",
         tone="cold", priority=2, needs=("TA",), needs_normal=False,
         about="The month holding the last frost before midsummer.",
         rule=lambda s: (
             f"The last frost of the first half of the year fell on "
             f"{s['ev_last_frost']['date']}"
             + (f", {abs(s['ev_last_frost']['delta'])} days "
                f"{'earlier' if s['ev_last_frost']['delta'] < 0 else 'later'} than usual"
                if s["ev_last_frost"]["delta"] else ", the usual date"))
         if s["ev_last_frost"] else None),

    dict(key="first_frost", label="First frost of autumn", group="Season", icon="snowflake",
         tone="cold", priority=2, needs=("TA",), needs_normal=False,
         about="The month holding the first frost after midsummer.",
         rule=lambda s: (
             f"The first frost of the second half of the year fell on "
             f"{s['ev_first_frost']['date']}"
             + (f", {abs(s['ev_first_frost']['delta'])} days "
                f"{'earlier' if s['ev_first_frost']['delta'] < 0 else 'later'} than usual"
                if s["ev_first_frost"]["delta"] else ", the usual date"))
         if s["ev_first_frost"] else None),

    # -- Days that stood out against their own date -------------------------------------------
    dict(key="record_days", label="Many record days", group="Records", icon="star", tone="warm",
         priority=1, needs=("TA",), needs_normal=False,
         about="Eight or more days were the warmest, coldest or wettest occurrence of their own "
               "calendar date; about four land in an average month. A largely gap-filled day "
               "cannot set one.",
         rule=lambda s: (
             f"{s['x']['nrec']} days set a record for their own calendar date: "
             + ", ".join(p for p in (
                 f"{s['n_recwarm']} warmest" if s["n_recwarm"] else None,
                 f"{s['n_reccold']} coldest" if s["n_reccold"] else None,
                 f"{s['n_recwet']} wettest" if s["n_recwet"] else None) if p))
         if s["x"]["nrec"] >= 8 else None),

    # -- Weather that a threshold on one variable cannot describe ------------------------------
    dict(key="wet_spell", label="Wet spell", group="Precipitation", icon="droplets", tone="wet",
         priority=2, needs=("PREC",), needs_normal=False,
         about="Seven or more consecutive days reaching 1 mm.",
         rule=lambda s: (f"{s['spell_wet']} consecutive days reaching 1 {s['u_PREC']}")
         if s["spell_wet"] >= 7 else None),

    dict(key="coldprec", label="Precipitation below freezing", group="Precipitation",
         icon="snow-cloud", tone="cold", priority=3, needs=("PREC", "TA"), needs_normal=False,
         about="Three or more days with at least 1 mm on which the temperature stayed below 1 °C. "
               "The gauge does not report phase, so this dates the possibility of snow, not "
               "snow itself. It is also where the gauge catches least.",
         rule=lambda s: (f"{s['n_coldprec']} days with at least 1 {s['u_PREC']} on which the "
                         f"maximum stayed below 1 {s['u_TA']}") if s["n_coldprec"] >= 3 else None),

    dict(key="freezethaw", label="Freeze-thaw", group="Temperature", icon="thermo-swing",
         tone="cold", priority=3, needs=("TA",), needs_normal=False,
         about="Ten or more days that dropped below 0 °C and rose above it again.",
         rule=lambda s: (f"{s['n_freezethaw']} days crossed freezing in both directions")
         if s["n_freezethaw"] >= 10 else None),

    dict(key="clear", label="Clear spell", group="Radiation", icon="sun", tone="sun", priority=3,
         needs=("SW_IN",), needs_normal=False,
         about="Eight or more days brighter than the 90th percentile for their date. Counted "
               "against the date, not a fixed threshold, so a bright January counts.",
         rule=lambda s: (f"{s['n_clear']} days in the brightest tenth for their date")
         if s["n_clear"] >= 8 else None),

    dict(key="overcast", label="Overcast spell", group="Radiation", icon="cloud", tone="dull",
         priority=3, needs=("SW_IN",), needs_normal=False,
         about="Eight or more days duller than the 10th percentile for their date.",
         rule=lambda s: (f"{s['n_overcast']} days in the dullest tenth for their date")
         if s["n_overcast"] >= 8 else None),

    # -- What only a whole year can say --------------------------------------------------------
    # Every badge above states something a month can be judged on, and travels outward to the
    # longer spans where the statement still holds. These run the other way: each is undefined
    # below a year, so each is marked `only` and appears at that scale alone.
    dict(key="net_sink", label="Net carbon sink", group="Carbon", icon="sprout", tone="grow",
         priority=1, needs=("NEE",), needs_normal=False, only=("year",),
         about="Over the whole year the site took up more carbon than it released. This is a "
               "statement no month can make: at this site nearly every summer month is a sink and "
               "nearly every winter month a source, so the sign of the balance belongs to the year.",
         rule=lambda s: (
             f"Net uptake of {abs(s['NEE']):.0f} {s['u_NEE']} over the year"
             + (f" ± {s['NEE_unc']:.0f}" if s["NEE_unc"] else "")
             + (f", {ordinal(s['NEE_rank'])} largest uptake of {s['NEE_n']} years"
                if s["NEE_rank"] else ""))
         if s["NEE"] is not None and s["NEE"] < 0 else None),

    dict(key="net_source", label="Net carbon source", group="Carbon", icon="leaf-fall",
         tone="warm", priority=1, needs=("NEE",), needs_normal=False, only=("year",),
         about="Over the whole year the site released more carbon than it took up. For a managed "
               "site this is the year a harvest, a ploughing or a drought outweighed the growing "
               "season, and it is visible at no shorter scale.",
         rule=lambda s: (
             f"Net release of {s['NEE']:.0f} {s['u_NEE']} over the year"
             + (f" ± {s['NEE_unc']:.0f}" if s["NEE_unc"] else "")
             + (f", {ordinal(s['NEE_n'] - s['NEE_rank'] + 1)} largest release of {s['NEE_n']} years"
                if s["NEE_rank"] else ""))
         if s["NEE"] is not None and s["NEE"] > 0 else None),

    dict(key="long_season", label="Long growing season", group="Season", icon="sprout",
         tone="grow", priority=2, needs=("TA",), needs_normal=False, only=("year",),
         about="The growing season ran at least ten days longer than the record median. The dates "
               "it began and ended are stated on their own months; only the year carries how long "
               "it lasted.",
         rule=lambda s: (
             f"The growing season ran {s['ev_gslen']['days']} days, "
             f"{s['ev_gslen']['delta']} more than the usual {s['ev_gslen']['normal']:.0f}")
         if (s["ev_gslen"] and s["ev_gslen"]["delta"] is not None
             and s["ev_gslen"]["delta"] >= SEASON_LENGTH_DELTA) else None),

    dict(key="short_season", label="Short growing season", group="Season", icon="leaf-fall",
         tone="cold", priority=2, needs=("TA",), needs_normal=False, only=("year",),
         about="The growing season ran at least ten days shorter than the record median.",
         rule=lambda s: (
             f"The growing season ran {s['ev_gslen']['days']} days, "
             f"{abs(s['ev_gslen']['delta'])} fewer than the usual "
             f"{s['ev_gslen']['normal']:.0f}")
         if (s["ev_gslen"] and s["ev_gslen"]["delta"] is not None
             and s["ev_gslen"]["delta"] <= -SEASON_LENGTH_DELTA) else None),

    dict(key="late_frost", label="Late spring frost", group="Season", icon="snowflake",
         tone="cold", priority=3, needs=("TA",), needs_normal=False, only=("year",),
         about="The last frost of spring fell at least a fortnight later than usual, so the risk "
               "to new growth ran later into the year than the site is used to.",
         rule=lambda s: (
             f"The last frost of spring fell on {s['ev_last_frost']['date']}, "
             f"{s['ev_last_frost']['delta']} days later than usual"
             + (f"; the frost-free period was {s['ev_frostfree']['days']} days"
                if s["ev_frostfree"] else ""))
         if (s["ev_last_frost"] and s["ev_last_frost"]["delta"] is not None
             and s["ev_last_frost"]["delta"] >= FROST_DATE_DELTA) else None),

    dict(key="early_frost", label="Early autumn frost", group="Season", icon="icicles",
         tone="cold", priority=3, needs=("TA",), needs_normal=False, only=("year",),
         about="The first frost of autumn fell at least a fortnight earlier than usual, cutting "
               "the frost-free period short at the other end.",
         rule=lambda s: (
             f"The first frost of autumn fell on {s['ev_first_frost']['date']}, "
             f"{abs(s['ev_first_frost']['delta'])} days earlier than usual"
             + (f"; the frost-free period was {s['ev_frostfree']['days']} days"
                if s["ev_frostfree"] else ""))
         if (s["ev_first_frost"] and s["ev_first_frost"]["delta"] is not None
             and s["ev_first_frost"]["delta"] <= -FROST_DATE_DELTA) else None),

    # The badge that exists because an annual mean hides exactly this. A year of two extremes and a
    # year of twelve ordinary months can carry the same figure, and only one of them was a year
    # worth opening.
    dict(key="swings", label="A year of extremes", group="Records", icon="thermo-swing",
         tone="warn", priority=2, needs=(), needs_normal=False, only=("year",),
         about="In four or more of the year's months, some variable stood at least two standard "
               "deviations from its own normal for that calendar month, measured against how far "
               "that variable varies between the record's other Januaries, Februaries and so on. "
               "An annual figure can average out to nothing while the months inside it swing at "
               "both ends, and this is the mark that tells the two apart.",
         rule=lambda s: (
             f"In {s['x']['nx']} months of this year, a variable stood at least "
             f"{EXTREME_MONTH_Z:g} standard deviations from its own normal for that calendar "
             f"month, taken against its spread across the other years"
             + (f". The furthest was {s['worst_month']['name']}: "
                f"{varreg.make(s['worst_month']['key']).short.lower()} "
                f"{s['worst_month']['z']:+.1f}"
                if s["worst_month"] else ""))
         if s["x"]["nx"] >= EXTREME_MONTHS else None),

    dict(key="saturated", label="In cloud", group="Radiation", icon="fog", tone="dull",
         priority=3, needs=("RH",), needs_normal=False,
         about="Twelve or more days whose mean relative humidity reached 95 %. At 47 m on the "
               "ridge, that is the tower inside low cloud or fog.",
         rule=lambda s: (f"{s['n_saturated']} days with a mean relative humidity of 95 "
                         f"{s['u_RH']} or more") if s["n_saturated"] >= 12 else None),
]


# ----------------------------------------------------------------------------------------------
# Metrics
#
# What a tile can be coloured by. Each metric names the field it reads on the month, the ramp it is
# drawn with and the daily quantity the micro-strip inside the tile shows. Every colour is a token
# of the shared stylesheet, resolved in the browser, so the light and the dark set stay the only
# place a colour is decided.
#
# `group` is what the page's picker groups the list under. Sixteen metrics in one flat list is a
# menu a reader has to read end to end to find out what is in it; the same sixteen under five
# headings can be scanned. It is a presentation field and nothing computes from it.
#
# `agg` is how the grid's margins - the figure beside each year and the one under each calendar
# month - combine twelve months or twenty-one years into one number. It defaults to the aggregation
# of the underlying variable, which is right for everything read straight off a product, and has to
# be stated where the metric is a derived quantity whose own behaviour differs: growing degree days
# accumulate, so a year is their sum, while the longest dry spell of a month does not accumulate
# into the longest dry spell of a year and is averaged. Leaving it to be inferred put the annual
# degree-day total out by a factor of twelve.
#
#   scale 'div'  two poles either side of `center`, neutral at the centre
#   scale 'seq'  one ramp from the low end of the domain to the high end
#
#   day  'value'  the daily statistic itself      'anom'  its departure from the daily normal
#        'flag'   whether the day set a threshold  'meas'  the measured share of the day
# ----------------------------------------------------------------------------------------------

METRICS = [
    dict(key="TA_anom", var="TA", field="anom", scale="div", center=0.0,
         poles=("--pole-cold", "--pole-warm"), digits=1,
         group="Temperature", label="Air temperature anomaly", short="TA anomaly",
         about="Monthly mean temperature minus the normal of that calendar month.",
         day=dict(kind="anom", stat="mean")),
    dict(key="TA", var="TA", field="value", scale="div", center=None,
         poles=("--pole-cold", "--pole-warm"), digits=1,
         group="Temperature", label="Air temperature, monthly mean", short="TA",
         about="Monthly mean temperature. Colour diverges about the record mean, so the seasons "
               "separate, not the years.",
         day=dict(kind="value", stat="mean")),
    dict(key="PREC_pctn", var="PREC", field="pctn", scale="div", center=100.0,
         poles=("--series-4", "--series-1"), digits=0, unit="%",
         group="Precipitation", label="Precipitation, % of normal", short="PREC % of normal",
         about="Monthly total as a percentage of the normal of that calendar month.",
         day=dict(kind="value", stat="sum")),
    dict(key="PREC", var="PREC", field="value", scale="seq",
         stops=("--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"),
         digits=0, group="Precipitation", label="Precipitation, monthly total", short="PREC total",
         about="Monthly precipitation total. A month with gaps under-reports, so the measured "
               "share is worth reading beside it.",
         day=dict(kind="value", stat="sum")),
    dict(key="SW_IN", var="SW_IN", field="value", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0,
         group="Radiation and humidity", label="Incoming shortwave, monthly mean", short="SW_IN",
         about="Monthly mean incoming shortwave radiation.",
         day=dict(kind="value", stat="mean")),
    dict(key="VPD", var="VPD", field="value", scale="seq",
         stops=("--neutral-mid", "--series-2"), digits=2,
         group="Radiation and humidity", label="Vapour pressure deficit, monthly mean", short="VPD",
         about="Monthly mean vapour pressure deficit, the atmosphere's evaporative demand.",
         day=dict(kind="value", stat="mean")),
    # The absolute mean is dominated by the seasons - every July is dry air and every January is
    # not - so the departure is the one that answers "which months were unusually dry", and for a
    # variable that exists to describe drought that is the question worth colouring by.
    dict(key="VPD_anom", var="VPD", field="anom", scale="div", center=0.0,
         poles=("--series-1", "--series-4"), digits=2,
         group="Radiation and humidity", label="Vapour pressure deficit anomaly",
         short="VPD anomaly",
         about="Monthly mean evaporative demand minus the normal of that calendar month. Amber is "
               "drier air than usual, blue damper: the same poles the precipitation anomaly "
               "uses, so dry reads as dry across the page.",
         day=dict(kind="anom", stat="mean")),
    dict(key="n_vpdstress", var="VPD", field="count", count="vpdstress", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0, unit="days",
         group="Radiation and humidity", label="Evaporative stress days per month",
         short="Stress days",
         about="Days whose maximum vapour pressure deficit reached 2 kPa, where stomata usually "
               "begin to close.",
         day=dict(kind="flag", flag="vpdstress")),
    dict(key="RH", var="RH", field="value", scale="seq",
         stops=("--neutral-mid", "--series-3"), digits=0,
         group="Radiation and humidity", label="Relative humidity, monthly mean", short="RH",
         about="Monthly mean relative humidity.",
         day=dict(kind="value", stat="mean")),
    dict(key="SWC", var="SWC", field="value", scale="seq",
         stops=("--neutral-mid", "--series-1"), digits=1,
         group="Soil", label="Soil water content", short="SWC",
         about="Monthly mean volumetric soil water content, homogenised across the "
               "2020 sensor change.",
         day=dict(kind="value", stat="mean")),

    # The carbon metrics. Green is uptake and red is release everywhere they appear, so the sign
    # of the net flux reads the same on the grid, on the anomaly and on the day panel; that is
    # also why the net flux diverges about zero rather than about the record mean, since zero is
    # the boundary the sign convention makes meaningful and the record mean is not.
    dict(key="NEE", var="NEE", field="value", scale="div", center=0.0,
         poles=("--series-3", "--pole-warm"), digits=0,
         group="Carbon", label="Net ecosystem exchange, monthly total", short="NEE",
         about="Monthly net exchange of CO₂. Green months are a net sink, red months a net "
               "source. A month with gaps under-reports the total in either direction, so the "
               "measured share is worth reading beside it.",
         day=dict(kind="value", stat="sum")),
    dict(key="NEE_anom", var="NEE", field="anom", scale="div", center=0.0,
         poles=("--series-3", "--pole-warm"), digits=0,
         group="Carbon", label="Net ecosystem exchange anomaly", short="NEE anomaly",
         about="Monthly net exchange minus the normal of that calendar month. Green is more "
               "carbon taken up than usual, red less - which for a month that is a sink either "
               "way is the more informative statement of the two.",
         day=dict(kind="anom", stat="sum")),
    dict(key="n_sink", var="NEE", field="count", count="sink", scale="seq",
         stops=("--neutral-mid", "--series-3"), digits=0, unit="days",
         group="Carbon", label="Sink days per month", short="Sink days",
         about="Days closing with a negative total, where uptake over the twenty-four hours "
               "exceeded release. The shoulders of the growing season are where this count "
               "separates years that a monthly total does not.",
         day=dict(kind="flag", flag="sink")),
    dict(key="GPP", var="GPP", field="value", scale="seq",
         stops=("--neutral-mid", "--series-3"), digits=0,
         group="Carbon", label="Gross primary productivity, monthly total", short="GPP",
         about="Monthly carbon fixed by photosynthesis, partitioned out of the net flux.",
         day=dict(kind="value", stat="sum")),
    dict(key="GPP_anom", var="GPP", field="anom", scale="div", center=0.0,
         poles=("--series-2", "--series-3"), digits=0,
         group="Carbon", label="Gross primary productivity anomaly", short="GPP anomaly",
         about="Monthly productivity minus the normal of that calendar month. The seasonal cycle "
               "dominates the absolute figure at any site with a winter, so the departure is what "
               "identifies a poor growing season.",
         day=dict(kind="anom", stat="sum")),
    dict(key="RECO", var="RECO", field="value", scale="seq",
         stops=("--neutral-mid", "--series-2"), digits=0,
         group="Carbon", label="Ecosystem respiration, monthly total", short="RECO",
         about="Monthly carbon returned by plant and soil respiration, partitioned out of the net "
               "flux.",
         day=dict(kind="value", stat="sum")),

    # The energy fluxes share a group because the question either one answers is how the available
    # energy was divided between them, which needs both on the page.
    dict(key="LE", var="LE", field="value", scale="seq",
         stops=("--neutral-mid", "--series-1"), digits=0,
         group="Energy", label="Latent heat flux, monthly mean", short="LE",
         about="Monthly mean latent heat flux, the energy leaving the surface as water vapour.",
         day=dict(kind="value", stat="mean")),
    dict(key="H", var="H", field="value", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0,
         group="Energy", label="Sensible heat flux, monthly mean", short="H",
         about="Monthly mean sensible heat flux, the energy leaving the surface as warm air. Read "
               "against the latent flux it states how the available energy was partitioned.",
         day=dict(kind="value", stat="mean")),

    # The two composite metrics answer the questions the per-variable ones cannot: how far from
    # normal a month was at all, and in how many independent ways at once.
    dict(key="zmax", var="TA", field="extra", extra="zmax", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=1, unit="sd",
         group="Across the variables", label="How unusual the month was", short="Unusualness",
         about="The furthest any one variable stood from its own normal for this calendar month, "
               "counted in standard deviations of that variable across the record and in either "
               "direction. One dimensionless scale, so a strange February and a strange July are "
               "comparable.",
         day=dict(kind="none")),
    dict(key="nsd", var="TA", field="extra", extra="nsd", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0, unit="variables",
         group="Across the variables",
         label="How many things were unusual at once", short="Unusual variables",
         about="How many of the five variables that can be compared this way (temperature, "
               "precipitation, radiation, evaporative demand, soil water) stood at least one "
               "standard deviation from their own normal for this calendar month. They do not "
               "move independently; the correlation between them is measured and shown beside "
               "the grid.",
         day=dict(kind="none")),
    dict(key="dtr", var="TA", field="extra", extra="dtr", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=1,
         group="Temperature", label="Diurnal temperature range", short="Day-night range",
         about="Mean of the daily maximum minus the daily minimum. It separates clear dry months "
               "from cloudy ones as sharply as radiation does, from the temperature record "
               "alone.",
         day=dict(kind="range", stats=("min", "max"))),
    dict(key="gdd", var="TA", field="extra", extra="gdd", scale="seq", agg="sum",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0, unit="K d",
         group="Temperature", label="Growing degree days above 5 °C", short="Degree days",
         about="Sum over the month of the daily mean above 5 °C, the base the growing season is "
               "taken above.",
         day=dict(kind="none")),
    dict(key="spell_dry", var="PREC", field="spell", spell="dry", scale="seq",
         stops=("--neutral-mid", "--series-4"), digits=0, unit="days",
         group="Precipitation", label="Longest dry spell", short="Dry spell",
         about="The longest run of consecutive days below 1 mm within the month. A month can "
               "reach its normal total and still hold a fortnight without rain.",
         day=dict(kind="none")),
    dict(key="n_wet", var="PREC", field="count", count="wet", scale="seq",
         stops=("--neutral-mid", "--seq-4", "--seq-6"), digits=0, unit="days",
         group="Precipitation", label="Wet days per month", short="Wet days",
         about="Days reaching 1 mm.",
         day=dict(kind="flag", flag="wet")),
    dict(key="n_clear", var="SW_IN", field="count", count="clear", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0, unit="days",
         group="Radiation and humidity", label="Clear days per month", short="Clear days",
         about="Days brighter than the 90th percentile for their own date, so a bright January "
               "day counts as one.",
         day=dict(kind="flag", flag="clear")),
    dict(key="n_hot", var="TA", field="count", count="hot", scale="seq",
         stops=("--neutral-mid", "--warm-1", "--warm-2", "--warm-3"), digits=0, unit="days",
         group="Temperature", label="Hot days per month", short="Hot days",
         about="Days with a daily maximum at or above 30 °C.",
         day=dict(kind="flag", flag="hot")),
    dict(key="n_frost", var="TA", field="count", count="frost", scale="seq",
         stops=("--neutral-mid", "--cold-1", "--cold-2"), digits=0, unit="days",
         group="Temperature", label="Frost days per month", short="Frost days",
         about="Days with a daily minimum below 0 °C.",
         day=dict(kind="flag", flag="frost")),
    dict(key="meas", var="TA", field="meas", scale="seq",
         stops=("--seq-7", "--seq-4", "--seq-1"), digits=0, unit="%",
         group="Data quality", label="Measured share, air temperature", short="Coverage",
         about="Percentage of the month's half-hours that are measured, not gap-filled or "
               "missing. Dark is complete.",
         day=dict(kind="meas")),
]


# ----------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------











# ----------------------------------------------------------------------------------------------
# Daily and hourly layers
#
# Both are columnar: one flat array per quantity over the whole span, indexed by the number of days
# (or hours) since the start. A month therefore carries an offset and a length instead of its own
# copy of the data, and the page can slice any window without an index of timestamps.
# ----------------------------------------------------------------------------------------------

def daily_frame(loaded, dates):
    """Daily statistics, the measured share of each day and the day flag word."""
    day = {}
    meas = {}
    for key, d in loaded.items():
        v = d["v"]
        agg = d["series"].resample("D").agg(list(v.daily_stats))
        if v.agg == "sum":
            # The gap-preserving sum replaces the one agg() produced, which reports 0 for a day
            # with no records at all.
            agg["sum"] = resample_agg(d["series"], "D", "sum")
        day[key] = agg.reindex(dates)
        meas[key] = (d["measured"].astype(float).resample("D").mean() * 100).reindex(dates)
    return day, meas


def flag_words(flags, day, meas, nrm, dates):
    """One integer per day holding every test that day passed, and the tests that survived.

    Bits are assigned here rather than in the registry, so a test dropped for want of a variable
    does not leave a hole in the word that the page would have to know about.
    """
    word = np.zeros(len(dates), dtype="int64")
    counts = {}
    kept = []
    for f in flags:
        if "fn" in f:
            try:
                hit = f["fn"](day, meas, nrm)
            except KeyError:
                # The test reads a variable this build does not include. Dropping it is right;
                # doing so silently is not, so the caller reports what it lost.
                continue
        else:
            stat = day[f["var"]][f["stat"]]
            hit = stat.lt(f["value"]) if f["op"] == "lt" else stat.ge(f["value"])
        hit = hit.reindex(dates).fillna(False).astype(bool)
        f = dict(f, bit=len(kept))
        kept.append(f)
        counts[f["key"]] = hit
        word |= hit.to_numpy().astype("int64") << f["bit"]
    return pd.Series(word, index=dates), counts, kept


def daily_normals(day, dates, keys):
    """The normal course of the year for every shipped daily statistic.

    Built from a centred window of `CLIM_WINDOW` days around each calendar date, pooled across all
    years, so a single cold 14 July does not become the normal for 14 July. The window is circular:
    the days around New Year use the end of the previous year.
    """
    doy = doy365(dates)
    normals = {}
    for key in keys:
        stats = {}
        for stat in ("mean", "sum", "min", "max"):
            if stat not in day[key].columns:
                continue
            values = day[key][stat].to_numpy(dtype=float)
            mean = np.full(366, np.nan)
            p10 = np.full(366, np.nan)
            p90 = np.full(366, np.nan)
            for target in range(1, 366):
                dist = np.abs(doy - target)
                sel = np.minimum(dist, 365 - dist) <= CLIM_WINDOW
                block = values[sel]
                block = block[~np.isnan(block)]
                if block.size < 20:
                    continue
                mean[target] = block.mean()
                p10[target] = np.percentile(block, 10)
                p90[target] = np.percentile(block, 90)
            stats[stat] = dict(mean=mean, p10=p10, p90=p90)
        normals[key] = stats
    return normals


def normals_payload(normals):
    """The daily normals rounded for JSON, which is the only place they are rounded."""
    return {key: {stat: {which: [r(x, 2) for x in arr] for which, arr in bands.items()}
                  for stat, bands in stats.items()} for key, stats in normals.items()}


def normal_accessor(normals, dates):
    """`nrm(var, stat, which)` as a series on the daily index, for the tests that compare a day
    against its own date rather than against a fixed threshold."""
    doy = doy365(dates)

    def nrm(var, stat, which):
        return pd.Series(normals[var][stat][which][doy], index=dates)
    return nrm


GROWING_SEASON_BASE = 5.0  # °C, the base the season and the degree-day sum are taken above

# ----------------------------------------------------------------------------------------------
# How unusual a month was, over how many things at once
#
# The composite counts axes, not variables. A drought has three limbs and they are not the same
# event: the water that fails to arrive (PREC), the water no longer stored (SWC) and the demand the
# air makes on what is left (VPD). Vapour pressure deficit is the one that closes stomata, so a
# composite of atmospheric dryness that omitted it would be measuring around the thing it is for.
# Radiation and temperature complete the set at five.
#
# Relative humidity is the one variable deliberately left out. VPD is the physically meaningful
# combination of temperature and humidity; RH beside it would be the same information a third time.
#
# **The five axes are not independent, and the page says so rather than implying otherwise.** VPD
# is computed from temperature and humidity, so a hot month tends to score on both. The correlation
# between every pair of axes is therefore measured from the record on each build and published with
# the composite, so a reader can see how much of "three axes at once" is three separate things.
#
# The axes a month cannot be judged on are dropped rather than counted as ordinary, and a month
# left with fewer than `COMPOSITE_MIN_AXES` of them carries no composite at all - a count out of
# two is not comparable with a count out of five, and showing it beside one would invite exactly
# that comparison.
# ----------------------------------------------------------------------------------------------

COMPOSITE_VARS = ("TA", "PREC", "SW_IN", "VPD", "SWC")
COMPOSITE_MIN_AXES = 4

# ----------------------------------------------------------------------------------------------
# Seasons
#
# The meteorological seasons, not the astronomical ones: whole months, and a winter that is
# December to February. A winter therefore crosses a year boundary and a calendar grid cuts every
# one of them in half, which is the reason this second scale exists at all.
#
# A winter is labelled by the year of its January, the usual convention. Two consequences are
# stated rather than hidden: the first winter of the record has no December, so it is short by a
# third and its coverage says so; and the last December belongs to a winter the record does not
# reach, so it appears in no season tile. Coverage is measured against the half-hours the season
# *should* hold rather than the ones the file happens to carry, which is what makes both visible.
#
# The four meteorological seasons are only the default. A site whose year does not divide that way
# says how it does: `seasons="DJFMAM"` gives two half-years, `seasons="none"` drops the scale
# entirely. Only the first season is stated and the rest follow from it, because seasons that
# overlap or leave a month out are not a scheme anyone wants to be able to express.
# ----------------------------------------------------------------------------------------------

MONTH_INITIAL = "JFMAMJJASOND"

# The four that have names in English. Anything else is named by its months, which is the honest
# label for a division this page invented at the caller's request.
CANONICAL_SEASONS = {
    (12, 1, 2): ("Winter", "winter"),
    (3, 4, 5): ("Spring", "spring"),
    (6, 7, 8): ("Summer", "summer"),
    (9, 10, 11): ("Autumn", "autumn"),
}

DEFAULT_SEASONS = "DJF"
NO_SEASONS = ("none", "off", "no", "")


def season_key(months):
    """`DJF` for December-January-February."""
    return "".join(MONTH_INITIAL[m - 1] for m in months)


def parse_season_spec(spec):
    """The months of the first season, from `DJF` or `12,1,2`, or None for a record without any.

    Month initials are ambiguous on their own - three of them name two months each - so they are
    read as a run of consecutive months rather than letter by letter. `JJA` is June-July-August
    because those three are consecutive and no other reading is.
    """
    text = str(spec if spec is not None else "").strip()
    if text.lower() in NO_SEASONS:
        return None
    if any(ch.isdigit() for ch in text):
        months = [int(x) for x in re.split(r"[,\s]+", text) if x]
        outside = [m for m in months if not 1 <= m <= 12]
        if outside:
            raise ValueError(f"seasons={spec!r}: {outside} is not a month number")
        if len(set(months)) != len(months):
            raise ValueError(f"seasons={spec!r} names the same month twice")
        return tuple(months)

    letters = text.upper()
    if not letters.isalpha() or len(letters) > 12:
        raise ValueError(
            f"seasons={spec!r} is not a run of month initials. Give the first season as its "
            f"initials (DJF, JJA, DJFMAM), as month numbers (12,1,2), or 'none'.")
    for start in range(1, 13):
        if all(MONTH_INITIAL[(start - 1 + i) % 12] == ch for i, ch in enumerate(letters)):
            return tuple(((start - 1 + i) % 12) + 1 for i in range(len(letters)))
    raise ValueError(
        f"seasons={spec!r}: no run of consecutive months has those initials. Month initials are "
        f"{MONTH_INITIAL} read around the year, so DJF and JJA work and 'DFJ' does not.")


def season_shift(months):
    """Which months of a season fall in the calendar year before the one it is labelled by.

    A season that crosses the new year is labelled by the year of its last month - a winter is the
    winter of its January, the usual convention - so the months before the boundary carry a one.
    """
    wraps = any(months[i] < months[i - 1] for i in range(1, len(months)))
    if not wraps:
        return {m: 0 for m in months}
    out, before_boundary = {}, True
    for i, m in enumerate(months):
        if i and m < months[i - 1]:
            before_boundary = False
        out[m] = 1 if before_boundary else 0
    return out


def season_scheme(spec=DEFAULT_SEASONS):
    """Every season of the year, derived from the definition of the first one.

    The rest follow by stepping through the year in blocks of the same length, so a scheme always
    covers all twelve months exactly once. That is why the length has to divide the year: a season
    of five months would leave a remainder with nowhere to go.
    """
    first = parse_season_spec(spec)
    if first is None:
        return []
    n = len(first)
    if 12 % n:
        raise ValueError(
            f"seasons={spec!r} defines a season of {n} months, which does not divide the year. "
            f"A season has to be 1, 2, 3, 4, 6 or 12 months long, so that the seasons derived "
            f"from it cover the year exactly once.")
    out = []
    for g in range(12 // n):
        months = tuple(((first[0] - 1 + g * n + i) % 12) + 1 for i in range(n))
        if n == 1:
            # Initials are not unique one month at a time - March and May are both `M` - and the
            # key identifies the span in the payload, so a one-month scheme is named by the month.
            key, label = calendar.month_abbr[months[0]], calendar.month_name[months[0]]
        else:
            key = season_key(months)
            label, _ = CANONICAL_SEASONS.get(months, (key, key))
        out.append(dict(key=key, group=g + 1, label=label, name=label.lower(), months=months,
                        shift=season_shift(months)))
    keys = [s["key"] for s in out]
    assert len(set(keys)) == len(keys), f"season keys are not unique: {keys}"
    return out


def season_note(scheme):
    """One sentence stating the scheme, for a page whose seasons the caller chose.

    The default needs no explanation; anything else does, because a reader has no way to know from
    a tile labelled `JJASON` that it is half a year rather than a quarter of one.
    """
    if not scheme:
        return None
    names = ", ".join(s["key"] for s in scheme)
    if [s["key"] for s in scheme] == ["DJF", "MAM", "JJA", "SON"]:
        return f"The four meteorological seasons: {names}."
    n = len(scheme[0]["months"])
    return (f"{len(scheme)} season{'s' if len(scheme) > 1 else ''} of {n} months, derived from "
            f"the first one this atlas was built with: {names}. This is not the usual four-season "
            f"division; every figure on this scale is taken over the months named.")

# The badges that mean the same thing over three months as over one. Everything defined on a
# z-score, a percentage of normal or a rank is scale-free and travels; everything defined on a
# count of days or a run of them does not, because "five frost days" is a remarkable January and an
# unremarkable winter. The counts are still shown on a season's page, as numbers rather than as
# claims.
#
# The six carbon badges satisfy that criterion - each is a rank or a z-score against the span's own
# peer group - and they belong here for the same reason the temperature ones do. They were absent
# for a while only because this set was written before the fluxes existed, which made a season the
# one scale that could show a carbon metric and then say nothing about it.
SEASON_BADGES = {
    "sparse", "record_warm", "record_cold", "warm", "cold", "record_wet", "record_dry",
    "wet", "dry", "sunny", "dull", "vpd_record", "vpd_high", "vpd_low", "vpd_soil",
    "soil_dry", "soil_wet", "hot_dry",
    "record_sink", "record_source", "sink_strong", "sink_weak", "gpp_high", "gpp_low",
    "gs_start", "gs_end", "last_frost", "first_frost",
}

# The same rule one scale further out, and it differs from the seasonal set in exactly one way: the
# four turning points drop out. Every year holds a last frost and a growing season, so at this scale
# the four of them would land on all twenty-one tiles and distinguish none of them; what a year has
# to say about its season is how long it ran and how late it began, which is what the year-only
# badges above state instead.
#
# What a year adds beyond this set is not here but in `only=("year",)`: the sign of the annual
# carbon balance, the length of the growing season, and the frost dates are claims no shorter span
# can make.
YEAR_BADGES = {
    "sparse", "record_warm", "record_cold", "warm", "cold", "record_wet", "record_dry",
    "wet", "dry", "sunny", "dull", "vpd_record", "vpd_high", "vpd_low", "vpd_soil",
    "soil_dry", "soil_wet", "hot_dry",
    "record_sink", "record_source", "sink_strong", "sink_weak", "gpp_high", "gpp_low",
}


def badge_at_scale(badge, scale):
    """Whether a badge is a claim this span can make.

    A badge marked `only` belongs to one scale and is withheld everywhere else; the rest travel as
    far as the sets above allow. Stated once here rather than at each call site, because a badge
    appearing at a scale its rule was not written for is the failure that is hard to see: it does
    not raise, it just marks every tile.
    """
    only = badge.get("only")
    if only:
        return scale in only
    if scale == "season":
        return badge["key"] in SEASON_BADGES
    if scale == "year":
        return badge["key"] in YEAR_BADGES
    return True


def season_periods(first_year, last_year, scheme):
    """The season spans of the record, as dictionaries the rest of the build can treat like months.

    A season is contiguous in the daily arrays, so it needs only an offset and a length; the offset
    of a season that reaches back into the previous year is clipped to the start of the record, and
    its coverage carries the rest of the story.
    """
    out = []
    for year in range(first_year, last_year + 1):
        for season in scheme:
            months, shift = season["months"], season["shift"]
            start = pd.Timestamp(year - shift[months[0]], months[0], 1)
            end = (pd.Timestamp(year - shift[months[-1]], months[-1], 1)
                   + pd.offsets.MonthEnd(0))
            out.append(dict(y=year, skey=season["key"], group=season["group"],
                            name=season["name"], label=season["label"],
                            title=f"{season['label']} {year}", start=start, end=end,
                            n_days=int((end - start).days) + 1,
                            months=months, shift=shift,
                            # The span's own id, replacing the pandas quarter the four-season
                            # scheme used to borrow: a year and a slot, which any scheme has.
                            period=year * 100 + season["group"]))
    return out


def season_ids(index, scheme):
    """The season span every record belongs to, as the same id `season_periods` assigns.

    Built from the month rather than from a pandas period frequency, because a frequency exists
    only for the four-quarter case and this has to group two half-years or twelve single months by
    the same rule.
    """
    ids = np.zeros(len(index), dtype="int64")
    month, year = index.month.to_numpy(), index.year.to_numpy()
    for season in scheme:
        for m in season["months"]:
            sel = month == m
            ids[sel] = (year[sel] + season["shift"][m]) * 100 + season["group"]
    return pd.Series(ids, index=index)


def composite_correlation(all_stats, months, keys, titles):
    """How far the axes duplicate one another, measured on the record rather than asserted.

    The z-scores are already taken against each calendar month's own normal, so correlating them
    across all months compares departures with seasonality removed - which is the correlation that
    matters for a count of simultaneous departures. Pairs are computed on the months where both
    axes could be judged.
    """
    axes = [k for k in COMPOSITE_VARS if k in keys]
    frame = pd.DataFrame([s["z"] for s in all_stats], index=months).reindex(columns=axes)
    corr = frame.corr(min_periods=24)
    strongest = None
    for i, a in enumerate(axes):
        for b in axes[i + 1:]:
            value = corr.loc[a, b]
            if pd.isna(value):
                continue
            if strongest is None or abs(value) > abs(strongest["r"]):
                strongest = dict(a=a, b=b, r=float(value))
    return dict(
        vars=axes, min_axes=COMPOSITE_MIN_AXES,
        n=int(frame.notna().all(axis=1).sum()),
        labels=[titles[k] for k in axes],
        correlation=[[r(corr.loc[a, b], 2) for b in axes] for a in axes],
        strongest=None if strongest is None else dict(
            a=strongest["a"], b=strongest["b"], r=r(strongest["r"], 2)),
    )


def season_events(day, dates):
    """The four dates that divide a year at this site, and how each compares with the record.

    The growing season uses the definition of `fluxatlas.stats.growing_season` - six
    consecutive days above the base, and the first such run below it after 1 July - so the calendar
    and the temperature dashboard cannot disagree about when a year's season ran. The frost
    boundaries are the plain ones: the last frost before midsummer and the first one after it.

    Each event is returned against the median date of the same event across the record, because the
    date on its own says nothing - "the season began on 3 April" is only interesting next to the
    fact that it usually begins two weeks later.
    """
    if "TA" not in day:
        return {}
    tmean, tmin = day["TA"]["mean"], day["TA"]["min"]
    raw = {}
    for year, block in tmean.groupby(dates.year):
        block = block.dropna()
        if block.empty:
            continue
        events = {}
        season = growing_season(block, base=GROWING_SEASON_BASE)
        if season is not None:
            events["gs_start"] = season["start"]
            events["gs_end"] = season["end"]
            events["gs_length"] = season["length"]
        frost = tmin.loc[f"{year}"].dropna()
        frost = frost[frost < 0]
        spring = frost[frost.index.month <= 6]
        autumn = frost[frost.index.month >= 7]
        if not spring.empty:
            events["last_frost"] = spring.index[-1]
        if not autumn.empty:
            events["first_frost"] = autumn.index[0]
        raw[year] = events

    # The median date of each event, as a day of the year, so a year can be placed against it.
    medians = {}
    for name in ("gs_start", "gs_end", "last_frost", "first_frost"):
        doys = [doy365(pd.DatetimeIndex([e[name]]))[0] for e in raw.values() if name in e]
        medians[name] = float(np.median(doys)) if len(doys) >= MIN_NORMAL_YEARS else None

    out = {}
    for year, events in raw.items():
        for name, when in events.items():
            if name == "gs_length":
                continue
            key = (year, when.month)
            median = medians[name]
            out.setdefault(key, {})[name] = dict(
                date=f"{when.day} {when:%B}",  # %-d is not portable to Windows
                delta=None if median is None
                else int(doy365(pd.DatetimeIndex([when]))[0] - median),
                length=events.get("gs_length"))
    return out


# ----------------------------------------------------------------------------------------------
# Years
#
# The third span scale, and the one that answers a different question from the other two. A month
# and a season are judged against the same month or season of other years; a year has no such peer
# group, so it is judged against every other year of the record. That is a single group rather than
# a cycle of twelve or four, and `normals` already takes the grouping as an argument, so the same
# machinery serves it: the normal is the record mean, the rank is the place among all years, and
# the anomaly is the departure from the record.
#
# Two things belong to a year and to nothing shorter, and they are the reason this scale is not
# just a coarser grid: the sign of the annual carbon balance, and how long the growing season ran.
# A month holds the date the season began; only the year holds how long it lasted.
# ----------------------------------------------------------------------------------------------

YEAR_SLUG = "YEAR"           # how a year is addressed in the page's URL: #2016-YEAR
# A month counts as extreme at two standard deviations rather than one and a half, and four of them
# make a year rather than three. The looser pair marked 18 of the 21 CH-LAE years, which is a badge
# that says nothing: the composite takes the largest departure across five axes, so any one axis
# reaching 1.5 in a month is ordinary. At 2.0 and four months it marks 4 years of 21, which is the
# rate the record badges run at.
EXTREME_MONTH_Z = 2.0        # the departure a month has to reach to count as an extreme one
EXTREME_MONTHS = 4           # how many of them make a year of extremes
SEASON_LENGTH_DELTA = 10     # days a growing season has to differ by before it is worth stating
FROST_DATE_DELTA = 14        # days a frost boundary has to move by before it is worth stating


def year_periods(first_year, last_year):
    """The record's years, as spans the rest of the build can treat like months and seasons."""
    out = []
    for year in range(first_year, last_year + 1):
        start, end = pd.Timestamp(year, 1, 1), pd.Timestamp(year, 12, 31)
        out.append(dict(y=year, group=1, name="year", label=str(year), title=str(year),
                        start=start, end=end, n_days=int((end - start).days) + 1, period=year))
    return out


def yearly_frames(loaded, spans):
    """The same three frames per calendar year, with coverage measured against a whole year.

    The denominator is the half-hours a year should hold, so a leap year is not reported as 100.3 %
    covered and the first year of a record that starts in March is short by exactly what it misses.
    """
    index = pd.Index([sp["y"] for sp in spans], dtype="int64")
    expected = pd.Series([sp["n_days"] * 48 for sp in spans], index=index, dtype=float)
    out = {}
    for key, d in loaded.items():
        v = d["v"]
        group = pd.Series(d["series"].index.year, index=d["series"].index)
        value = (d["series"].groupby(group).sum(min_count=1) if v.agg == "sum"
                 else d["series"].groupby(group).mean()).reindex(index)
        meas = (d["measured"].astype(float).groupby(group).sum().reindex(index)
                .fillna(0) / expected * 100)
        avail = (d["series"].notna().astype(float).groupby(group).sum().reindex(index)
                 .fillna(0) / expected * 100)
        unc = aggregate_uncertainty(d, lambda s: s.groupby(group).sum(min_count=1), index)
        out[key] = dict(value=value, meas=meas, avail=avail, unc=unc)
    return out


def year_events(day, dates):
    """Per year, how long the growing season and the frost-free period ran, against the record.

    `season_events` dates the four turning points and is keyed by the month each falls in, which is
    what a month tile needs. These two are lengths rather than dates: they exist only once the year
    is complete, they are the quantities a reader compares between years, and neither can be read
    off a month at all.

    Each is returned against the record median, for the same reason the dates are: 194 days of
    growing season says nothing until it is set beside the 178 the site usually gets.
    """
    if "TA" not in day:
        return {}
    tmean, tmin = day["TA"]["mean"], day["TA"]["min"]
    raw = {}
    for year, block in tmean.groupby(dates.year):
        block = block.dropna()
        found = {}
        if not block.empty:
            season = growing_season(block, base=GROWING_SEASON_BASE)
            if season is not None:
                found["gslen"] = int(season["length"])
        frost = tmin.loc[f"{year}"].dropna()
        frost = frost[frost < 0]
        spring, autumn = frost[frost.index.month <= 6], frost[frost.index.month >= 7]
        if not spring.empty and not autumn.empty:
            found["frostfree"] = int((autumn.index[0] - spring.index[-1]).days)
        if found:
            raw[int(year)] = found

    medians = {}
    for name in ("gslen", "frostfree"):
        values = [found[name] for found in raw.values() if name in found]
        medians[name] = float(np.median(values)) if len(values) >= MIN_NORMAL_YEARS else None

    out = {}
    for year, found in raw.items():
        out[year] = {name: dict(days=value, normal=medians[name],
                                delta=None if medians[name] is None
                                else int(round(value - medians[name])))
                     for name, value in found.items()}
    return out


def year_extras(st, months_in_year, lengths):
    """The statistics a year carries that a month or a season cannot, written onto its stats.

    Two of them are lengths taken from `year_events`. The third is a count of the year's own months
    that departed far from their normals, which is what separates a year that was uniformly mild
    from one that averaged out to nothing while swinging at both ends. Only a scale that contains
    months can ask it.
    """
    for name in ("gslen", "frostfree"):
        st[f"ev_{name}"] = lengths.get(name)

    extreme = [s for s in months_in_year
               if s["x"]["zmax"] is not None and s["x"]["zmax"] >= EXTREME_MONTH_Z]
    st["x"]["nx"] = len(extreme)
    st["x"]["gslen"] = lengths.get("gslen", {}).get("days")
    st["x"]["frostfree"] = lengths.get("frostfree", {}).get("days")

    # The month that departed furthest, and on which axis, so a year can point at where its
    # unusualness came from rather than only stating that it had some.
    judged = [s for s in months_in_year if s["x"]["zmax"] is not None]
    st["worst_month"] = None
    if judged:
        worst = max(judged, key=lambda s: s["x"]["zmax"])
        axis, z = max(worst["z"].items(), key=lambda kv: abs(kv[1]))
        st["worst_month"] = dict(name=worst["month_name"], key=axis, z=z,
                                 n=sum(1 for v in worst["z"].values() if abs(v) >= 1),
                                 nz=len(worst["z"]))
    return st


def ordinal(n):
    """`1` as `1st`. The rank is read as a placing, and a placing is written as one."""
    if n is None:
        return ""
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def place_among(value, values, first="high"):
    """Where `value` places among `values`, counting from whichever end is the notable one.

    Returned as (rank, n) so a caller can say "3rd of 21" and decide whether that is worth saying.
    Ties take the same rank, which is what stops two identical growing seasons being reported as
    first and second.
    """
    kept = [v for v in values if v is not None]
    if value is None or not kept:
        return None, 0
    better = sum(1 for v in kept if (v > value if first == "high" else v < value))
    return better + 1, len(kept)


def year_standout(st, peers, keys, loaded):
    """What set this year apart from the others, strongest first.

    The badges say what a year earned against fixed thresholds. This says where it *placed*, which
    is the other half of the question and the one a threshold cannot answer: a year can miss every
    badge and still be the third warmest of twenty-one, and a reader looking for what made a year
    special is owed both.

    Each entry is ranked by how far the year stood from the rest, so the list opens with the
    strongest statement the record supports rather than with whichever variable happens to be first
    in the registry.
    """
    out = []

    for key in keys:
        v = loaded[key]["v"]
        value, z, rank, n = st[key], st[f"{key}_z"], st[f"{key}_rank"], st[f"{key}_n"]
        if value is None or rank is None or n is None:
            continue
        # Distance from whichever end of the ranking is nearer: 2nd of 21 and 20th of 21 are both
        # remarkable, and the middle of the ranking is what is not.
        place = min(rank, n - rank + 1)
        strength = abs(z) if z is not None else 0.0
        if strength < 1 and place > 3:
            continue
        note = f"{ordinal(rank)} of {n} years"
        if v.rank_first == "low":
            # NEE is ranked from the negative end, so "1st" means the largest uptake rather than
            # the largest number, and a list of placings has to say so where it is not obvious.
            note += f" ({ordinal(1)} = {v.rank_note})"
        detail = f"{value:.{v.digits}f} {v.units}"
        anomaly = st[f"{key}_anom"]
        if anomaly is not None and v.sign:
            # A signed figure states a convention, so the direction is written out beside it
            # rather than left to a reader who may not carry it.
            detail = (f"{abs(value):.{v.digits}f} {v.units} net "
                      f"{v.sign['low'] if value < 0 else v.sign['high']}")
            normal = value - anomaly
            noun = v.sign["low"] if normal <= 0 else v.sign["high"]
            more = anomaly < 0 if normal <= 0 else anomaly > 0
            z = st[f"{key}_z"]
            detail += (f", about the same {noun} as the record"
                       if z is not None and abs(z) < 0.25 else
                       f", {abs(anomaly):.{v.digits}f} {'more' if more else 'less'} {noun} than "
                       f"the record")
        elif anomaly is not None:
            detail += f", {anomaly:+.{v.digits}f} against the record"
        out.append(dict(k=v.short, v=f"{note}. {detail}", tone="rank", s=strength + 3.0 / place))

    # The carbon balance leads whatever its placing, because the sign of the annual figure is the
    # headline statement of a flux year and is true of no shorter span.
    if "NEE" in keys and st["NEE"] is not None:
        v = loaded["NEE"]["v"]
        total = st["NEE"]
        line = (f"The site was a net {'sink' if total < 0 else 'source'} of "
                f"{abs(total):.0f} {v.units}")
        if st["NEE_unc"] is not None:
            line += f" ± {st['NEE_unc']:.0f}"
        if st["NEE_rank"] is not None:
            line += f", {ordinal(st['NEE_rank'])} of {st['NEE_n']} years"
        out.append(dict(k="Carbon balance", v=line + ".", tone="carbon", s=99.0))

    if st["worst_month"] is not None and st["worst_month"]["n"]:
        worst = st["worst_month"]
        title = loaded[worst["key"]]["v"].short if worst["key"] in loaded else worst["key"]
        # Written out rather than named as a count of axes. "On 4 axes at once" is the composite
        # card's own shorthand and means nothing away from it; what a reader needs is which
        # variable moved furthest and how much else moved with it.
        out.append(dict(
            k="Most unusual month",
            v=(f"{worst['name']}: {title.lower()} stood {worst['z']:+.1f} standard deviations "
               f"from its {worst['name']} normal"
               + (f", and {worst['n']} of the {worst['nz']} variables that could be judged stood "
                  f"at least 1 from theirs" if worst["n"] > 1 else
                  ", the only variable that far from normal that month")
               + "."),
            tone="rank", s=abs(worst["z"])))

    # The three that are only interesting against the other years of this record. A growing season
    # of 225 days and 58 record days are numbers; the longest of twenty-one and 4th of twenty-one
    # are statements, and which of the two a reader gets is the difference between a page that
    # reports and a page that says something.
    for name, label, unit in (("gslen", "Growing season", "days long"),
                              ("frostfree", "Frost-free period", "days")):
        found = st[f"ev_{name}"]
        if not found:
            continue
        rank, n = place_among(found["days"], [p["x"][name] for p in peers])
        place = min(rank, n - rank + 1) if rank else None
        line = f"{found['days']} {unit}"
        if found["delta"]:
            line += (f", {abs(found['delta'])} days "
                     f"{'longer' if found['delta'] > 0 else 'shorter'} than usual "
                     f"({found['normal']:.0f})")
        elif found["delta"] == 0:
            line += ", the usual length"
        if rank and place <= 3:
            line += (f". {ordinal(rank)} longest of {n} years" if rank <= place
                     else f". {ordinal(n - rank + 1)} shortest of {n} years")
        out.append(dict(k=label, v=line + ".", tone="season",
                        s=abs(found["delta"] or 0) / 10.0 + (3.0 / place if place else 0)))

    if st["x"]["nx"]:
        n_extreme = st["x"]["nx"]
        out.append(dict(k="Months that stood out", v=(
            f"In {n_extreme} month{'s' if n_extreme > 1 else ''} of this year, a variable stood at "
            f"least {EXTREME_MONTH_Z:g} standard deviations from its own normal for that calendar "
            f"month."), tone="rank", s=0.8 * n_extreme))

    rank, n = place_among(st["x"]["nrec"], [p["x"]["nrec"] for p in peers])
    if st["x"]["nrec"] and rank and min(rank, n - rank + 1) <= 3:
        out.append(dict(k="Record days", v=(
            f"{st['x']['nrec']} days were the warmest, coldest or wettest occurrence of their own "
            f"calendar date, {ordinal(rank)} of {n} years."), tone="rank", s=3.0 / rank))

    out.sort(key=lambda item: -item["s"])
    return [dict(k=item["k"], v=item["v"], tone=item["tone"]) for item in out]


def hourly_layer(loaded, first_year, last_year):
    """The diurnal detail, as one flat integer array per variable.

    Stored scaled to whole numbers because the precision the day panel draws at is a tenth of a
    degree, and a full float repr of two hundred thousand values is most of the finished page.
    """
    start = pd.Timestamp(f"{first_year}-01-01 00:00")
    stop = pd.Timestamp(f"{last_year}-12-31 23:00")
    index = pd.date_range(start, stop, freq="h")
    out = {}
    for key, d in loaded.items():
        v = d["v"]
        if not v.hourly:
            continue
        how = "sum" if v.agg == "sum" else "mean"
        series = resample_agg(d["series"], "h", how).reindex(index)
        scaled = (series * v.scale).round()
        out[key] = dict(scale=v.scale, units=v.units, title=v.title,
                        values=[None if pd.isna(x) else int(x) for x in scaled])
    assert not out or len(index) == (pd.Timestamp(f"{last_year}-12-31") -
                                     pd.Timestamp(f"{first_year}-01-01")).days * 24 + 24, \
        "the hourly index is not a whole number of days"
    return dict(start=f"{first_year}-01-01", n=len(index), vars=out)


# ----------------------------------------------------------------------------------------------
# Monthly layer, normals and badges
# ----------------------------------------------------------------------------------------------

def aggregate_uncertainty(d, grouped, index):
    """The uncertainty of each span, in the units of the variable.

    `grouped` turns a half-hourly series into one figure per span; `index` is the span index the
    result is reported on. Each component is aggregated by the rule its kind demands and the
    components are then combined in quadrature.

    The distinction between the kinds is the whole point. A random error is independent between
    records, so it goes as sqrt(sum of squares) and shrinks with the length of the span. A
    systematic one is the same choice applied to every record in the span, so it sums linearly and
    does not shrink. Treating the second as the first is what reports a median CH-Oe2 year as
    +/- 9 g C m-2 when the ensemble puts it at +/- 121.
    """
    v = d["v"]
    if not d.get("uncertainty"):
        return None
    mean_like = v.agg != "sum"
    total = None
    for component in d["uncertainty"]:
        if component["kind"] == varreg.ENSEMBLE:
            # Aggregate each member over the span first, then take half the spread of the totals.
            # A threshold choice moves the whole span together, so the spread has to be measured
            # after the aggregation and never before it.
            members = pd.concat([grouped(s) for s in component["series"]], axis=1)
            part = (members.max(axis=1) - members.min(axis=1)) / 2
        else:
            sigma = component["series"][0]
            n_present = grouped(sigma.notna().astype(float))
            n_total = grouped(pd.Series(1.0, index=sigma.index))
            if component["kind"] == varreg.QUADRATURE:
                part = np.sqrt(grouped(sigma ** 2))
            else:
                part = grouped(sigma.abs())
            # The uncertainty columns are published for about three quarters of the records, so an
            # aggregate over what is present understates the span. Scaling by the share carried
            # assumes the absent records resemble the present ones, which is the least the figure
            # can assume without either overstating or quietly leaving a quarter of the span out.
            scale = (n_total / n_present.replace(0, np.nan))
            part = part * (np.sqrt(scale) if component["kind"] == varreg.QUADRATURE else scale)
            if mean_like:
                part = part / n_total
        part = part.reindex(index)
        total = part if total is None else np.sqrt(total ** 2 + part ** 2)
    return total


def monthly_frames(loaded, months):
    """Monthly aggregate, measured share, available share and uncertainty, per variable."""
    out = {}
    for key, d in loaded.items():
        v = d["v"]
        value = resample_agg(d["series"], "MS", v.agg).reindex(months)
        meas = (d["measured"].astype(float).resample("MS").mean() * 100).reindex(months)
        avail = (d["series"].notna().astype(float).resample("MS").mean() * 100).reindex(months)
        unc = aggregate_uncertainty(d, lambda s: s.resample("MS").sum(min_count=1), months)
        out[key] = dict(value=value, meas=meas, avail=avail, unc=unc)
    return out


def seasonal_frames(loaded, spans, scheme):
    """The same three frames per season, with coverage measured against a whole season.

    A share of the records the file happens to hold would report the first winter, which has no
    December, as complete. The denominator here is the half-hours the season should contain, so a
    season the record only partly reaches is short by exactly as much as it is missing.
    """
    index = pd.Index([sp["period"] for sp in spans], dtype="int64")
    expected = pd.Series([sp["n_days"] * 48 for sp in spans], index=index, dtype=float)
    out = {}
    for key, d in loaded.items():
        v = d["v"]
        group = season_ids(d["series"].index, scheme)
        value = (d["series"].groupby(group).sum(min_count=1) if v.agg == "sum"
                 else d["series"].groupby(group).mean()).reindex(index)
        meas = (d["measured"].astype(float).groupby(group).sum().reindex(index)
                .fillna(0) / expected * 100)
        avail = (d["series"].notna().astype(float).groupby(group).sum().reindex(index)
                 .fillna(0) / expected * 100)
        unc = aggregate_uncertainty(d, lambda s: s.groupby(group).sum(min_count=1), index)
        out[key] = dict(value=value, meas=meas, avail=avail, unc=unc)
    return out


def normals(frames_by_var, groups, years):
    """Normals for each group of the cycle, from the spans complete enough to support one.

    `groups` labels every span with the slot of the cycle it belongs to: the calendar month for the
    monthly scale, the season for the seasonal one. One function serves both, so a winter is
    ranked against winters by exactly the rule a July is ranked against Julys.

    A normal built from whatever happens to be present would be pulled by the spans that are least
    trustworthy, and every anomaly and rank derived from it would inherit that. The qualifying rule
    is stated once here and used by everything downstream.
    """
    groups = np.asarray(groups)
    years = np.asarray(years)
    out = {}
    for key, frames in frames_by_var.items():
        # Availability, not measurement: a normal is built from every span the product covers. The
        # gap-filled series is the one the field publishes and the one this page is of, and holding
        # it to a measured threshold would quietly build the normal from a different, sparser
        # record. How much of it was measured is warned about, not gated on.
        value, qualifies = frames["value"], frames["avail"] >= varreg.coverage(key).normal
        by_group = {}
        for g in sorted(set(groups.tolist())):
            sel = (groups == g) & qualifies.to_numpy()
            block = value[sel].dropna()
            if len(block) < MIN_NORMAL_YEARS:
                by_group[g] = None
                continue
            block_years = years[(groups == g) & qualifies.to_numpy()][value[sel].notna().to_numpy()]
            by_group[g] = dict(mean=float(block.mean()), sd=float(block.std()), n=int(len(block)),
                               min=float(block.min()), max=float(block.max()),
                               min_year=int(block_years[int(np.argmin(block.to_numpy()))]),
                               max_year=int(block_years[int(np.argmax(block.to_numpy()))]))
        # Ranks are computed within the qualifying spans only, so a sparse span is not ranked.
        ranks = pd.Series(pd.NA, index=value.index, dtype="Int64")
        for g in sorted(set(groups.tolist())):
            sel = groups == g
            ranks[sel] = rank_of(value[sel], qualifies[sel], first=varreg.rank_first(key))
        out[key] = dict(by_group=by_group, ranks=ranks, qualifies=qualifies)
    return out


class SpanStats(dict):
    """A span's statistics, with one deliberate default.

    A day test that reads a variable outside the selection is dropped from the build, so a badge
    asking for its count is asking about something that was never tested for. Zero is the honest
    answer - the build cannot have observed what it did not look for - and it lets one badge
    registry serve every selection without each rule restating which variables it depends on.

    The default is confined to the count and spell namespaces on purpose. Any other missing key is
    still a KeyError, which is what catches a rule reading a statistic that does not exist.
    """

    def __missing__(self, key):
        if key.startswith(("n_", "spell_")):
            return 0
        raise KeyError(key)


def span_stats(sp, keys, frames_by_var, norm, counts, spells, day, events, loaded):
    """Every number a badge rule may read, for one span, as one flat dictionary.

    A span is a month or a season. Both carry an index label into the aggregated frames, a slot of
    the cycle to be judged against, and a stretch of days; nothing below this line needs to know
    which of the two it has, which is what keeps a winter and a July describable by one registry.
    """
    idx, group = sp["idx"], sp["group"]
    s = SpanStats(y=sp["y"], m=sp.get("m"), month_name=sp["name"], n_days=sp["n_days"],
                  keys=list(keys))
    for key in keys:
        v = loaded[key]["v"]
        frames, n = frames_by_var[key], norm[key]
        value = frames["value"].get(idx)
        value = None if pd.isna(value) else float(value)
        nm = n["by_group"][group]
        rank = n["ranks"].get(idx)
        s[key] = value
        s[f"u_{key}"] = v.units
        unc = None if frames.get("unc") is None else frames["unc"].get(idx)
        s[f"{key}_unc"] = None if unc is None or pd.isna(unc) else float(unc)
        s[f"{key}_meas"] = None if pd.isna(frames["meas"].get(idx)) else float(frames["meas"][idx])
        s[f"{key}_avail"] = None if pd.isna(frames["avail"].get(idx)) else float(frames["avail"][idx])
        s[f"{key}_norm"] = nm["mean"] if nm else None
        s[f"{key}_sd"] = nm["sd"] if nm else None
        s[f"{key}_n"] = nm["n"] if nm else None
        s[f"{key}_rank"] = None if pd.isna(rank) else int(rank)
        if value is not None and nm:
            s[f"{key}_anom"] = value - nm["mean"]
            s[f"{key}_z"] = (value - nm["mean"]) / nm["sd"] if nm["sd"] else None
            s[f"{key}_pctn"] = 100 * value / nm["mean"] if nm["mean"] > 0 else None
        else:
            s[f"{key}_anom"] = s[f"{key}_z"] = s[f"{key}_pctn"] = None

        # The extreme day of the span, which is what a badge quotes as its evidence.
        block = day[key].loc[sp["start"]:sp["end"]]
        for stat in ("min", "max", "sum"):
            if stat in block.columns:
                col = block[stat].dropna()
                s[f"{key}_day{stat}"] = float(col.max()) if len(col) else None
        if "min" in block.columns:
            col = block["min"].dropna()
            s[f"{key}_daymin"] = float(col.min()) if len(col) else None

    for key, series in counts.items():
        s[f"n_{key}"] = int(series.get(idx, 0))
    for key, series in spells.items():
        s[f"spell_{key}"] = int(series.get(idx, 0))

    # Statistics that belong to the span rather than to one of its variables. They are what the
    # tiles beyond the six products are built from, and what the extra metrics colour by.
    s["x"] = {}
    if "TA" in keys:
        block = day["TA"].loc[sp["start"]:sp["end"]]
        dtr = (block["max"] - block["min"]).dropna()
        gdd = (block["mean"] - GROWING_SEASON_BASE).clip(lower=0).dropna()
        s["x"]["dtr"] = float(dtr.mean()) if len(dtr) else None
        s["x"]["gdd"] = float(gdd.sum()) if len(gdd) else None
    s["x"]["nrec"] = sum(s.get(f"n_{k}", 0) for k in ("recwarm", "reccold", "recwet"))

    # The composite: how far from normal this span was on its most unusual axis, and on how many
    # axes at once. Only the axes that are present, sufficiently measured and have a normal are
    # judged, and the number judged travels with the answer.
    s["z"] = {}
    for key in COMPOSITE_VARS:
        if key not in keys:
            continue
        z, cov = s[f"{key}_z"], s[f"{key}_avail"]
        if z is None or cov is None or cov < varreg.coverage(key).badge:
            continue
        s["z"][key] = z
    s["x"]["nz"] = len(s["z"])
    if len(s["z"]) >= COMPOSITE_MIN_AXES:
        s["x"]["zmax"] = max(abs(z) for z in s["z"].values())
        s["x"]["nsd"] = sum(1 for z in s["z"].values() if abs(z) >= 1)
    else:
        s["x"]["zmax"] = None
        s["x"]["nsd"] = None

    # The turning points of the year that fall inside this span. A season inherits them from
    # whichever of its months holds them.
    found = {}
    for month_key in sp["event_keys"]:
        found.update(events.get(month_key, {}))
    for name in ("gs_start", "gs_end", "last_frost", "first_frost"):
        s[f"ev_{name}"] = found.get(name)
    return s


def carbon_phrase(value, units, sign):
    """A signed exchange as a figure and its direction: "25 g C m-2 net uptake".

    Every badge that quotes one of these numbers goes through here, because a bare "+25" states a
    convention rather than a fact, and a badge that assumed the sign - "25 taken up" of a month
    that released 25 - was worse than one that said nothing.
    """
    if value is None:
        return "no figure"
    if not sign:
        return f"{value:.0f} {units}"
    # A figure that rounds to zero is not a release of nothing: at the precision the page prints,
    # the span came out level, and that is what it should say.
    if round(abs(value)) == 0:
        return f"{sign['zero']}, within 1 {units}"
    return f"{abs(value):.0f} {units} net {sign['low'] if value < 0 else sign['high']}"


def evaluate_badges(s, keys, scale="month"):
    """Which badges this month earns, and what each of them rests on.

    A rule that reads a key the statistics do not carry is a bug in the registry, not a month
    without a badge, so the KeyError is re-raised naming the badge rather than swallowed.
    """
    noun = {"month": "month", "season": "season", "year": "year"}[scale]
    peers = "this calendar month" if scale == "month" else \
        "this season in other years" if scale == "season" else "the record's years"
    earned, suppressed = [], []
    for badge in BADGES:
        if not badge_at_scale(badge, scale):
            continue
        blocked = None
        for need in badge["needs"]:
            if need not in keys:
                blocked = f"{need} is not included in this build"
            elif s[need] is None:
                blocked = f"no {need} data in this {noun}"
            elif s[f"{need}_avail"] is None or s[f"{need}_avail"] < varreg.coverage(need).badge:
                blocked = (f"the record covers only {s[f'{need}_avail']:.0f} % of this span for "
                           f"{need}, below the {varreg.coverage(need).badge:.0f} % a badge needs")
            elif badge.get("needs_normal", True) and s[f"{need}_norm"] is None:
                blocked = f"{need} has no normal across {peers}"
            elif badge.get("needs_normal", True) and not s[f"{need}_sd"]:
                # A normal can exist and still have no spread - a sensor stuck at one reading, or a
                # variable that is zero throughout the same month of every year. Every badge phrased
                # as a departure divides by that spread, so there is nothing for them to say.
                blocked = (f"{need} does not vary across the same span in other years, so a "
                           f"departure from its normal is undefined")
            if blocked:
                break
        if blocked:
            suppressed.append(dict(key=badge["key"], why=blocked))
            continue
        try:
            why = badge["rule"](s)
        except KeyError as exc:
            raise KeyError(f"badge {badge['key']!r} reads {exc}, which the month statistics do "
                           f"not carry") from None
        if why:
            earned.append(dict(k=badge["key"], t=why))

    # A badge that states a compound of two others removes them: the compound says both, and a
    # month carrying all three spends its tile repeating itself.
    folded = {k for b in earned
              for k in next(x for x in BADGES if x["key"] == b["k"]).get("supersedes", ())}
    earned = [b for b in earned if b["k"] not in folded]

    earned.sort(key=lambda b: next(x["priority"] for x in BADGES if x["key"] == b["k"]))
    return earned, suppressed


# ----------------------------------------------------------------------------------------------
# Trend
#
# The one statistic on this page that is about the record rather than about a span of it, and the
# reason it exists: everything else here compares a month against a normal drawn from all twenty-one
# years, and that normal is not a fixed climate. If the record moves, the baseline sits between its
# early years and its late ones, and a warm month at the end of the record is partly being measured
# against a climate that has gone. The size of that effect is a number, so it is computed and shown
# rather than left for a reader to suspect.
#
# The estimator is `fluxatlas.stats.trend` - a Theil-Sen slope, which one extreme year does not
# move, with Kendall's tau to test a monotonic trend without assuming normal residuals. Importing it
# rather than restating it is the same rule the badges follow: the calendar must not disagree with
# the temperature dashboard about the slope of a series.
#
# Three rules keep a slope from saying more than it can.
#
# - **A trend is taken on the quantity the grid shows.** `row_value` reads the finished row, so the
#   number the slope is fitted through is the number under the reader's cursor.
# - **A sparse span does not take part.** Coverage gates a trend by the rule that gates a normal: a
#   year that was half-measured would move a slope exactly as a real change would.
# - **A year's figure needs its whole year.** A mean of ten qualifying months is not the mean of the
#   year and a total of ten is certainly not its total, so an incomplete year is dropped from the
#   record-wide trend rather than aggregated from what is present.
# ----------------------------------------------------------------------------------------------

def row_value(metric, row):
    """The number a metric shows on one span, read back from the finished row.

    The trend is fitted through the values the grid is coloured by rather than through a parallel
    computation, so a slope cannot describe a quantity the tiles do not show.
    """
    field = metric["field"]
    if field == "count":
        return row["c"].get(metric["count"])
    if field == "spell":
        return row["sp"].get(metric["spell"])
    if field == "extra":
        return row["x"].get(metric["extra"])
    return row[metric["var"]][dict(value="v", anom="a", pctn="p", meas="meas")[field]]


def coverage_phrase(keys, field):
    """The measured-share rule for this build, as one clause fit to drop into a sentence.

    With meteorology alone there is a single threshold and the clause is just "90 %". Once a flux
    is in the build there are two, and stating either on its own would be wrong about half the
    page - so each is named with the variables it governs.
    """
    groups = {}
    for key in keys:
        groups.setdefault(getattr(varreg.coverage(key), field), []).append(key)
    if len(groups) == 1:
        return f"{next(iter(groups)):.0f} %"
    parts = [f"{threshold:.0f} % for {', '.join(ks)}"
             for threshold, ks in sorted(groups.items(), reverse=True)]
    return " and ".join(parts)


def thin_spans(loaded, frames_by_var, months):
    """Per variable, the spans measured below its warning line - and how thin the thinnest is.

    Nothing is withheld on account of this. The gap-filled value is used exactly as if it were
    fully measured, because that series is the published product and is what the page is of. The
    count is reported at build time and the spans are marked on the grid, so a reader is told what
    a figure rests on rather than being quietly handed a shorter record.
    """
    out = {}
    for key in loaded:
        warn = varreg.coverage(key).warn
        meas = frames_by_var[key]["meas"].reindex(months)
        thin = meas[meas < warn].dropna()
        out[key] = dict(warn=warn, n=int(len(thin)), n_total=int(meas.notna().sum()),
                        lowest=None if thin.empty else float(thin.min()),
                        worst=None if thin.empty else f"{thin.idxmin():%B %Y}")
    return out


def report_thin_spans(thin, quiet=False):
    """Say which variables lean hardest on the gap-filling, once, at build time."""
    if quiet:
        return
    for key, d in thin.items():
        if not d["n"]:
            continue
        say(f"  warning: {key} is under {d['warn']:.0f} % measured in {d['n']} of "
            f"{d['n_total']} months (lowest {d['lowest']:.0f} % in {d['worst']}); the gap-filled "
            f"values are used and those months are marked on the grid")


def row_qualifies(metric, row):
    """Whether a span is covered well enough to take part in a yearly figure, and so in a trend.

    Availability, as everywhere else: the year is formed wherever the product covers all twelve of
    its months, however much of them was measured.
    """
    return _at_least(row[metric["var"]]["avail"], varreg.coverage(metric["var"]).normal)


def _at_least(cover, floor):
    return cover is not None and cover >= floor


def trend_of(pairs):
    """The slope through (year, value) pairs, or the count alone where there are too few.

    Returning the count rather than nothing is what lets the page say *why* a column carries no
    slope - "eight qualifying years" is an answer, an empty cell is not.
    """
    series = pd.Series({y: v for y, v in pairs if v is not None}, dtype=float).dropna().sort_index()
    if len(series) < TREND_MIN_YEARS:
        return dict(n=int(len(series)))
    t = trend(series)
    fit = t["fit"]
    return dict(slope=r(t["slope"], 4), lo=r(t["low"], 4), hi=r(t["high"], 4),
                p=r(t["pvalue"], 4), tau=r(t["tau"], 3), n=int(len(series)),
                y0=int(series.index.min()), y1=int(series.index.max()),
                # The two ends of the fitted line, so a chart can draw the slope it is stating
                # rather than re-fitting one in the browser and risking a line that disagrees with
                # the number printed beside it.
                fit=[r(float(fit.iloc[0]), 4), r(float(fit.iloc[-1]), 4)])


def yearly_figures(metric, agg, span_rows, n_cols):
    """One figure per complete year on this metric: the same figure the grid's year column shows.

    A year is only formed where every one of its spans qualifies. Aggregating what happens to be
    present would let coverage masquerade as a trend - and for a metric that sums, a year missing
    two months is simply a smaller year.
    """
    by_year = {}
    for row in span_rows:
        by_year.setdefault(row["y"], []).append(row)
    out = []
    for year, rows_in in sorted(by_year.items()):
        values = [row_value(metric, row) for row in rows_in if row_qualifies(metric, row)]
        if len(values) < n_cols or any(v is None for v in values):
            continue
        out.append((year, sum(values) if agg == "sum" else sum(values) / len(values)))
    return out


def metric_trends(metric, agg, span_rows, col_of, n_cols):
    """The slope down each column of the grid, and the one through the record's own years."""
    # The coverage metric is the one a coverage gate cannot be applied to: selecting the months that
    # are well measured and then fitting a trend through how well measured they are is circular.
    if metric["field"] == "meas":
        return None, None
    by_col = {}
    for row in span_rows:
        by_col.setdefault(str(col_of(row)), []).append(row)
    cols = {col: trend_of([(row["y"], row_value(metric, row))
                           for row in rows_in if row_qualifies(metric, row)])
            for col, rows_in in by_col.items()}
    return cols, trend_of(yearly_figures(metric, agg, span_rows, n_cols))


def epoch_split(metric, agg, span_rows, n_cols):
    """The record halved, as two means with the years each was taken from.

    A slope states a rate, which is the right form for a comparison across metrics and the wrong one
    for judging a single month. Two means in the units of the variable are what make the size of the
    movement legible beside the one normal every anomaly on this page is taken against.
    """
    if metric["field"] == "meas":
        return None
    figures = yearly_figures(metric, agg, span_rows, n_cols)
    if len(figures) < 2 * EPOCH_MIN_YEARS:
        return dict(n=len(figures))
    half = len(figures) // 2
    early, late = figures[:half], figures[half:]

    def block(part):
        return dict(mean=r(sum(v for _, v in part) / len(part), 3), n=len(part),
                    y0=part[0][0], y1=part[-1][0])
    whole = sum(v for _, v in figures) / len(figures)
    return dict(early=block(early), late=block(late), n=len(figures), mean=r(whole, 3),
                bias=r(sum(v for _, v in late) / len(late) - whole, 3))


# ----------------------------------------------------------------------------------------------
# Payload
# ----------------------------------------------------------------------------------------------

def build_payload(loaded, *, site, site_long, source=None, with_hourly=True, quiet=False,
                  seasons=DEFAULT_SEASONS):
    keys = list(loaded)
    first_year, last_year = span(loaded)
    dates = pd.date_range(f"{first_year}-01-01", f"{last_year}-12-31", freq="D")
    months = pd.date_range(f"{first_year}-01-01", f"{last_year}-12-01", freq="MS")

    day, meas = daily_frame(loaded, dates)
    # The daily normals come before the day tests, because some of the tests are a comparison
    # against them rather than against a fixed threshold.
    daily_norm = daily_normals(day, dates, keys)
    nrm = normal_accessor(daily_norm, dates)

    flags = day_flags({k: loaded[k]["v"] for k in keys})
    word, hits, flags = flag_words(flags, day, meas, nrm, dates)
    dropped = [f["key"] for f in day_flags({k: loaded[k]["v"] for k in keys})
               if f["key"] not in hits]
    if dropped:
        print(f"  day tests dropped for want of a variable: {', '.join(dropped)}")

    counts_month = {k: v.resample("MS").sum().reindex(months) for k, v in hits.items()}
    # Spells are the runs a count cannot show: a month can reach a high count without ever holding
    # the threshold for a week. The dry spell is the one run defined by the absence of a threshold.
    spell_defs = {name: hits[name] for name in ("hot", "frost", "wet", "vpdstress")
                  if name in hits}
    if "wet" in hits:
        spell_defs["dry"] = ~hits["wet"] & day["PREC"]["sum"].notna()
    spells = {}
    for name, mask in spell_defs.items():
        spells[name] = pd.Series({ts: longest_spell(mask.loc[f"{ts:%Y-%m}"])[0] for ts in months},
                                 dtype="int64")

    monthly = monthly_frames(loaded, months)
    norm = normals(monthly, [ts.month for ts in months], [ts.year for ts in months])
    events = season_events(day, dates)

    # Which variables lean hardest on the gap-filling. Computed before anything is built from them,
    # so the warning reaches the console ahead of the figures it qualifies.
    thin = thin_spans(loaded, monthly, months)
    report_thin_spans(thin, quiet=quiet)

    # -- Seasons -------------------------------------------------------------------------------
    # The second scale, built by the same machinery: a season is judged against the same season of
    # other years exactly as a July is judged against Julys. Which seasons those are is the
    # caller's, and a record with none skips the scale altogether.
    scheme = season_scheme(seasons)
    season_spans = season_periods(first_year, last_year, scheme) if scheme else []
    seasonal = seasonal_frames(loaded, season_spans, scheme) if scheme else {}
    season_index = pd.Index([sp["period"] for sp in season_spans], dtype="int64")
    season_norm = (normals(seasonal, [sp["group"] for sp in season_spans],
                           [sp["y"] for sp in season_spans]) if scheme else {})
    season_counts = {}
    season_spells = {}
    if scheme:
        ids = season_ids(dates, scheme)
        season_counts = {k: pd.Series(v.groupby(ids).sum())
                         .reindex(season_index).fillna(0) for k, v in hits.items()}
        for name, mask in spell_defs.items():
            season_spells[name] = pd.Series(
                {sp["period"]: longest_spell(mask.loc[sp["start"]:sp["end"]])[0]
                 for sp in season_spans}, dtype="int64")

    def span_row(sp, frames_by_var, group_norm, counts, spell_set, scale, extra=None):
        """One tile's worth of payload, for any of the three span scales.

        `extra` writes the statistics that belong to one scale alone onto the span before its
        badges are judged, which is how the year-only rules reach the lengths and counts that no
        month carries.
        """
        st = span_stats(sp, keys, frames_by_var, group_norm, counts, spell_set, day, events,
                        loaded)
        if extra is not None:
            extra(st)
        earned, suppressed = evaluate_badges(st, keys, scale=scale)
        # A span may start before the record does, in which case it is clipped and its coverage
        # already says so.
        i0 = int((sp["start"] - dates[0]).days)
        n = sp["n_days"]
        if i0 < 0:
            n, i0 = n + i0, 0
        row = dict(y=sp["y"], i0=i0, n=int(max(0, min(n, len(dates) - i0))),
                   b=earned, sup=suppressed,
                   c={k: int(st[f"n_{k}"]) for k in hits},
                   sp={k: int(st[f"spell_{k}"]) for k in spell_set},
                   x={k: r(v, 1) for k, v in st["x"].items()},
                   z={k: r(v, 2) for k, v in st["z"].items()},
                   ev={k[3:]: st[k] for k in ("ev_gs_start", "ev_gs_end", "ev_last_frost",
                                              "ev_first_frost") if st[k]})
        for key in keys:
            digits = loaded[key]["v"].digits
            row[key] = dict(v=r(st[key], digits), a=r(st[f"{key}_anom"], digits),
                            z=r(st[f"{key}_z"], 2), p=r(st[f"{key}_pctn"], 0),
                            r=st[f"{key}_rank"], n=st[f"{key}_n"],
                            # Kept finer than the value it qualifies: a sensible heat interval of
                            # 0.4 W m-2 rounds to "0" at the variable's own precision, and an
                            # interval printed as zero reads as certainty. The page decides how
                            # many of these decimals to show.
                            u=r(st[f"{key}_unc"], digits + 3),
                            meas=r(st[f"{key}_meas"], 0), avail=r(st[f"{key}_avail"], 0))
        return row, st

    # -- Months ------------------------------------------------------------------------------
    rows, all_stats = [], []
    for ts in months:
        y, m = int(ts.year), int(ts.month)
        sp = dict(idx=ts, group=m, y=y, m=m, name=calendar.month_name[m],
                  n_days=calendar.monthrange(y, m)[1], start=ts,
                  end=ts + pd.offsets.MonthEnd(0), event_keys=[(y, m)])
        row, st = span_row(sp, monthly, norm, counts_month, spells, "month")
        row["m"] = m
        rows.append(row)
        all_stats.append(st)

    season_rows = []
    for sp in season_spans:
        # A month of a season that reaches back over the new year belongs to the previous calendar
        # year, which the scheme's own shift states rather than a hard-coded December.
        calendar_months = [[sp["y"] - sp["shift"][mm], mm] for mm in sp["months"]]
        sp = dict(sp, idx=sp["period"], event_keys=[(y, mm) for y, mm in calendar_months])
        row, _ = span_row(sp, seasonal, season_norm, season_counts, season_spells, "season")
        row.update(s=sp["skey"], label=sp["label"], title=sp["title"], months=calendar_months)
        season_rows.append(row)

    # -- Years ---------------------------------------------------------------------------------
    # The third scale, and the one whose peer group is the record itself: a year is judged against
    # every other year rather than against the same slot of the cycle, which is `normals` with one
    # group. Its months are already computed, so what a year adds over a coarser aggregate is what
    # it can say about them - how many of them departed, and which departed furthest.
    year_spans = year_periods(first_year, last_year)
    yearly = yearly_frames(loaded, year_spans)
    year_index = pd.Index([sp["y"] for sp in year_spans], dtype="int64")
    year_norm = normals(yearly, [1] * len(year_spans), [sp["y"] for sp in year_spans])
    year_counts = {k: pd.Series(v.groupby(dates.year).sum()).reindex(year_index).fillna(0)
                   for k, v in hits.items()}
    year_spells = {name: pd.Series({sp["y"]: longest_spell(mask.loc[sp["start"]:sp["end"]])[0]
                                    for sp in year_spans}, dtype="int64")
                   for name, mask in spell_defs.items()}
    lengths = year_events(day, dates)

    year_rows, year_stats = [], []
    for i, sp in enumerate(year_spans):
        sp = dict(sp, idx=sp["y"], event_keys=[(sp["y"], m) for m in range(1, 13)])
        months_in_year = all_stats[i * 12:(i + 1) * 12]
        row, st = span_row(
            sp, yearly, year_norm, year_counts, year_spells, "year",
            extra=lambda s, mm=months_in_year, found=lengths.get(sp["y"], {}):
                year_extras(s, mm, found))
        row.update(s=YEAR_SLUG, label=str(sp["y"]), title=str(sp["y"]))
        year_rows.append(row)
        year_stats.append(st)

    # What set each year apart, ranked, and computed once every year is known: half of what makes a
    # year notable is its place among the others, which a single year cannot see. The badges are
    # thresholds and this is a placing - a year can miss every badge and still be the third warmest.
    for row, st in zip(year_rows, year_stats):
        row["stood"] = year_standout(st, year_stats, keys, loaded)

    # -- Metric domains ----------------------------------------------------------------------
    # Computed here rather than in the browser so the scale bar, the tiles and the day strips all
    # read one domain, and so it does not move when a filter hides part of the grid.
    #
    # Each scale gets its own: three months of precipitation is three times a month of it, and one
    # domain across both would leave every season tile at the dark end of the ramp saying nothing.
    def span_values(metric, span_rows, field):
        """The column of numbers a metric colours, for one scale."""
        if field == "count":
            return [row["c"][metric["count"]] for row in span_rows]
        if field == "spell":
            return [row["sp"][metric["spell"]] for row in span_rows]
        if field == "extra":
            return [row["x"].get(metric["extra"]) for row in span_rows]
        short = dict(value="v", anom="a", pctn="p", meas="meas")[field]
        return [row[metric["var"]][short] for row in span_rows]

    def domains_for(metric, values, daily_values, field, var):
        """The colour domain of one metric on one scale, and the wider one its day strips need."""
        if field == "meas":
            return None, [0.0, 100.0], [0.0, 100.0]
        if metric["scale"] == "div":
            # A diverging scale is symmetric about its centre, or the same departure reads as two
            # different colours depending on its sign. Where no centre is given the record's own
            # mean is it, which is what makes an absolute temperature tile separate the seasons.
            center = metric["center"]
            if center is None:
                # A build with no seasons has no season values to take a centre from, and neither
                # has a metric whose variable is missing throughout. Zero is the honest fallback:
                # nothing is coloured on that scale anyway.
                present = [x for x in values if x is not None and not pd.isna(x)]
                center = float(np.mean(present)) if present else 0.0
            spread = percentile_domain([(x - center) if x is not None else None for x in values],
                                       symmetric=True)
            domain = [center + spread[0], center + spread[1]]
            if metric["day"]["kind"] == "value":
                spread = percentile_domain([x - center for x in daily_values], symmetric=True)
                day_domain = [center + spread[0], center + spread[1]]
            else:
                day_domain = percentile_domain(daily_values, symmetric=True) if daily_values \
                    else [-1.0, 1.0]
            return center, domain, day_domain
        # A quantity that accumulates is read against zero, so its ramp starts there; one that does
        # not would waste most of the ramp on values the record never reaches.
        floor_at_zero = (field in ("count", "spell", "extra")
                         or loaded[var]["v"].agg == "sum")
        domain = percentile_domain(values)
        day_domain = percentile_domain(daily_values) if daily_values else [0.0, 1.0]
        if floor_at_zero:
            domain = [0.0, domain[1]]
            day_domain = [0.0, day_domain[1]]
        return None, domain, day_domain

    metrics = []
    for metric in METRICS:
        key, var, field = metric["key"], metric["var"], metric["field"]
        if var not in keys:
            continue
        if field == "count" and metric["count"] not in counts_month:
            continue  # its day test was dropped, so the count would be a column of zeros
        if field == "extra" and all(row["x"].get(metric["extra"]) is None for row in rows):
            # The composite is the case this exists for: it needs COMPOSITE_MIN_AXES axes before it
            # will form a value at all, so a selection of one or two variables can offer it in the
            # picker and then colour every tile grey. A metric with nothing to say is left out.
            continue
        if metric["day"]["kind"] == "range":
            daily_values = (day[var]["max"] - day[var]["min"]).dropna().tolist()
        elif field in ("count", "spell", "extra") \
                or metric["day"]["kind"] in ("flag", "meas", "none"):
            daily_values = []
        else:
            daily_values = day[var][metric["day"]["stat"]].dropna().tolist()

        center, domain, day_domain = domains_for(
            metric, span_values(metric, rows, field), daily_values, field, var)
        _, season_domain, _ = domains_for(
            metric, span_values(metric, season_rows, field), daily_values, field, var)
        _, year_domain, _ = domains_for(
            metric, span_values(metric, year_rows, field), daily_values, field, var)

        entry = {k: metric[k] for k in ("key", "label", "short", "about", "scale", "digits", "day",
                                       "group")}
        # A count of days is a count whatever the variable behind it does, so the default follows
        # the variable only where the metric reads it directly.
        entry.update(agg=metric.get("agg", "sum" if field == "count"
                                     else loaded[var]["v"].agg if field == "value"
                                     else "mean"))
        entry.update(var=var, field=field, count=metric.get("count"), spell=metric.get("spell"),
                     extra=metric.get("extra"),
                     units=metric.get("unit", loaded[var]["v"].units),
                     poles=list(metric.get("poles", [])), stops=list(metric.get("stops", [])),
                     center=r(center, 3), domain=[r(domain[0], 3), r(domain[1], 3)],
                     season_domain=[r(season_domain[0], 3), r(season_domain[1], 3)],
                     year_domain=[r(year_domain[0], 3), r(year_domain[1], 3)],
                     day_domain=[r(day_domain[0], 3), r(day_domain[1], 3)])

        # The trend down each column of the grid, on both scales, and the one through the years.
        # A season's slope is taken on seasons rather than inherited from its months: three months
        # aggregated is a different series from three series aggregated, and only the first is what
        # the season row of the grid shows.
        col_trend, year_trend = metric_trends(metric, entry["agg"], rows, lambda x: x["m"], 12)
        season_col_trend, _ = metric_trends(metric, entry["agg"], season_rows,
                                            lambda x: x["s"], 4)
        # The year scale has one column, and its slope is fitted through the year tiles themselves
        # rather than inherited from `trend_year`. The two are close but not the same series: a
        # year aggregated from twelve monthly means weights a 28-day February like a 31-day July,
        # and the figure the year tile shows does not.
        year_col_trend, _ = metric_trends(metric, entry["agg"], year_rows,
                                          lambda x: YEAR_SLUG, 1)
        entry.update(trend=col_trend, season_trend=season_col_trend, trend_year=year_trend,
                     year_trend=year_col_trend,
                     epoch=epoch_split(metric, entry["agg"], rows, 12))
        metrics.append(entry)

    # -- Badge registry, with the icons checked against the ones the page can draw ------------
    icons = set(re.findall(r"^\s{4}'([\w-]+)':", (ASSETS / "calendar.js").read_text(encoding="utf-8"),
                           flags=re.M))
    badge_meta = []
    for badge in BADGES:
        assert badge["icon"] in icons, (
            f"badge {badge['key']!r} asks for icon {badge['icon']!r}, which calendar.js does not "
            f"draw - it would render as an empty box")
        # Counted per scale, because a badge means a different number of things at each: the legend
        # says "18 months" beside a month grid and "4 years" beside a year grid, and a year-only
        # badge would otherwise report zero of a thing it cannot be.
        def earned_by(span_rows, key=badge["key"]):
            return sum(1 for row in span_rows for b in row["b"] if b["k"] == key)

        # Asked of `badge_at_scale` rather than read off `only`, because `only` is one of the three
        # things that decide it. Reading `only` alone told the legend that a count of frost days was
        # judged at the season scale, where it is not, and the count of zero it then printed read as
        # "no season had one" rather than "this is not a claim a season makes".
        badge_meta.append(dict(key=badge["key"], label=badge["label"], group=badge["group"],
                               icon=badge["icon"], tone=badge["tone"],
                               scales=[sc for sc in ("month", "season", "year")
                                       if badge_at_scale(badge, sc)],
                               about=badge["about"].format(
                                   sparse=SPARSE_COVERAGE,
                                   flux_sparse=varreg.FLUX_COVERAGE.warn),
                               n=earned_by(rows), n_season=earned_by(season_rows),
                               n_year=earned_by(year_rows)))

    # -- Variables and their day flags --------------------------------------------------------
    # `metric` names the metric that reads the variable straight off the product, which is the one
    # a statement about the variable itself - its trend, its two halves - has to be taken from. It
    # is resolved here rather than by matching keys in the browser, where the fact that a metric
    # happens to be named after its variable would become a rule nothing enforces.
    variables = []
    for key in keys:
        v = loaded[key]["v"]
        own = next((m["key"] for m in metrics if m["var"] == key and m["field"] == "value"), None)
        variables.append(dict(key=key, title=v.title, short=v.short, units=v.units,
                              digits=v.digits, agg=v.agg, product=v.source,
                              column=v.column, ship=list(v.ship), metric=own,
                              first_year=int(v.first_year), last_year=int(v.last_year),
                              # The page hatches sparse tiles and gates its own "best month"
                              # search on these, so they travel per variable rather than being
                              # re-derived in the browser from the meta defaults.
                              cov=dict(badge=v.coverage.badge, normal=v.coverage.normal,
                                       warn=v.coverage.warn),
                              thin=thin.get(key, {}).get("n", 0),
                              # The month panel groups and colours by this, and orders meteorology
                              # before the fluxes.
                              family=v.family,
                              # Which end takes rank 1, and what that end is. Shipped only where it
                              # is not the obvious one, so the page annotates the surprising case
                              # and leaves the rest alone.
                              rank_first=v.rank_first,
                              rank_note=None if v.rank_first == "high" else v.rank_note,
                              # What each end of this variable's range is called. The variable page
                              # lists its highest and lowest months, and "highest NEE" is the
                              # largest release rather than anything a reader would call a high.
                              word_high=v.extremes["high"], word_low=v.extremes["low"],
                              # The words for either side of zero. The page writes the direction
                              # out beside every figure of a variable that has them, because a
                              # signed number states a convention the reader may not carry.
                              sign=v.sign,
                              # What a "+/-" on this variable covers. A page that showed the same
                              # symbol for an interval covering the threshold choice and one
                              # covering only the random term would be saying two different things
                              # with one mark.
                              unc_note=v.uncertainty_note,
                              unc_columns=[c for comp in loaded[key]["uncertainty"]
                                           for c in comp["columns"]],
                              about=v.about))

    payload = dict(
        meta=dict(
            site=site, site_long=site_long,
            first_year=int(first_year), last_year=int(last_year),
            n_months=len(rows), n_days=len(dates), n_years=len(year_rows),
            year_slug=YEAR_SLUG,
            extreme_month_z=EXTREME_MONTH_Z, extreme_months=EXTREME_MONTHS,
            generated=datetime.now().strftime("%Y-%m-%d %H:%M"),
            min_badge_coverage=MIN_BADGE_COVERAGE, normal_min_coverage=NORMAL_MIN_COVERAGE,
            min_normal_years=MIN_NORMAL_YEARS, sparse_coverage=SPARSE_COVERAGE,
            # The thresholds as prose, since they are no longer one number each and the page states
            # them in running text in several places.
            cov_badge_text=coverage_phrase(keys, "badge"),
            cov_normal_text=coverage_phrase(keys, "normal"),
            cov_warn_text=coverage_phrase(keys, "warn"),
            # The seasons are the caller's, so the page states which scheme it is on rather than
            # letting a tile labelled `JJASON` be read as a quarter of a year.
            season_note=season_note(scheme),
            season_months=len(scheme[0]["months"]) if scheme else 0,
            # Every statistic on this page is computed on the gap-filled product, so the page has to
            # say so and say what leans hardest on it. This is the disclosure, not a gate.
            thin=thin,
            clim_window=CLIM_WINDOW, trend_min_years=TREND_MIN_YEARS,
            epoch_min_years=EPOCH_MIN_YEARS,
            composite_vars=[k for k in COMPOSITE_VARS if k in keys],
            composite_min_axes=COMPOSITE_MIN_AXES,
            composite=composite_correlation(all_stats, months, keys,
                                            {k: loaded[k]["v"].title for k in keys}),
            source=source,
            author=AUTHOR, affiliation=AFFILIATION, affiliation_url=AFFILIATION_URL,
            repository=REPOSITORY, version=VERSION,
        ),
        variables=variables,
        metrics=metrics,
        badges=badge_meta,
        flags=[dict(key=f["key"], var=f["var"], bit=f["bit"], label=f["label"],
                    short=FLAG_SHORT[f["key"]]) for f in flags],
        months=rows,
        seasons=season_rows,
        years=year_rows,
        season_defs=[dict(key=x["key"], label=x["label"], name=x["name"],
                          months=list(x["months"])) for x in scheme],
        days=dict(
            start=f"{dates[0]:%Y-%m-%d}", n=len(dates),
            flags=[int(x) for x in word.to_numpy()],
            series={f"{key}_{stat}": rlist(day[key][stat], loaded[key]["v"].digits)
                    for key in keys for stat in loaded[key]["v"].ship},
            meas={key: [None if pd.isna(x) else int(round(x)) for x in meas[key].to_numpy()]
                  for key in keys},
        ),
        normals=normals_payload(daily_norm),
        climatology={key: {str(m): norm[key]["by_group"][m] for m in range(1, 13)}
                     for key in keys},
        season_climatology={key: {x["key"]: season_norm[key]["by_group"][x["group"]]
                                  for x in scheme} for key in keys} if scheme else {},
        hourly=hourly_layer(loaded, first_year, last_year) if with_hourly else None,
    )

    # The grid is the page, so its shape is asserted rather than assumed: one tile per month of
    # every year, and every tile addressing a real window of the daily arrays.
    assert len(rows) == (last_year - first_year + 1) * 12, "the grid is not a whole number of years"
    assert len(season_rows) == (last_year - first_year + 1) * len(scheme), \
        "the season grid is not a whole number of years"
    assert len(year_rows) == last_year - first_year + 1, "one tile per year of the record"
    assert all(row["i0"] + row["n"] <= len(dates) for row in rows), "a month runs past the days"
    return payload


# ----------------------------------------------------------------------------------------------
# Render
# ----------------------------------------------------------------------------------------------

def render(payload, out_path, title=None):
    """Inline the assets and the payload into one self-contained HTML file."""
    template = (ASSETS / "template.html").read_text(encoding="utf-8")
    css = ((ASSETS / "base.css").read_text(encoding="utf-8") + "\n"
           + (ASSETS / "calendar.css").read_text(encoding="utf-8"))
    js = (ASSETS / "calendar.js").read_text(encoding="utf-8")

    # One mark, two uses: inlined into the topbar, where it takes the page's --neutral-mid, and
    # base64'd into the favicon, where nothing external may be fetched. Base64 rather than percent
    # encoding because the mark is nine colours and every one of them carries a `#`.
    logo = (ASSETS / "logo.svg").read_text(encoding="utf-8").strip()
    favicon = ("data:image/svg+xml;base64,"
               + base64.b64encode(logo.encode("utf-8")).decode("ascii"))

    # `</script>` inside the JSON would end the tag early, and `<!--` would open a comment.
    data = (json.dumps(payload, allow_nan=False, separators=(",", ":"))
            .replace("</", "<\\/").replace("<!--", "<\\!--"))
    m = payload["meta"]

    html = (template
            .replace("/*__CSS__*/", css)
            .replace("/*__DATA__*/", data)
            .replace("/*__JS__*/", js)
            .replace("<!--__LOGO__-->", logo)
            .replace("__FAVICON__", favicon)
            .replace("__TITLE__", title or f"{m['site']} — atlas "
                                           f"{m['first_year']}–{m['last_year']}"))

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    return out_path

