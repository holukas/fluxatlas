"""Build an atlas from the merged CH-LAE meteo product, with every site setting the package offers.

    uv run python examples/build_lae_meteo_atlas.py
    uv run python examples/build_lae_meteo_atlas.py --input PATH/99_METEO_MERGED_2004-2026.09.parquet
                                                    --reference PATH/MeteoSwiss_LAE_30MIN_2004-2026.09.parquet
    uv run python examples/build_lae_meteo_atlas.py --open

Writes `CH-LAE_atlas.html` into `examples/output/`, which is not tracked.

What this example is for
------------------------
A FLUXNET file needs none of this: its columns are named to a convention the registry already
knows, and `variables=["TA", "PREC"]` is enough. The CH-LAE merged product is the other case, and
the fuller one. Its columns are named to the site's own convention, its flags follow no FLUXNET
convention, it carries a second flag naming the sensor behind each value, several variables are
measured at several depths, the corrected series ship beside the measured ones, and the site keeps
a reference station two and a half kilometres away. Every one of those is a setting here, passed to
the library as data; none of it is in the package.

What each setting does
----------------------
- `column`, `qc` - which column supplies the variable, and its fill flag.
- `qc_legend`, `measured_codes` - what each fill code means, and which codes are measurements.
  Soil temperature's METHOD flag names the sensor generation as well as the fill, so two of its
  codes are measured.
- `source` - the second flag, with a legend and the code of the reference era.
- `raw` - the uncorrected twin of a homogenised series, read only to show what the correction did.
- `SWC@0.05` and the like - one series per depth, each with its own page.
  `primary={"SWC": "SWC@0.2"}` says which depth stands in for soil water content in the composite,
  the badges and the grid's soil metric.
- `reference` - the station column a variable is compared with, and whether to split night from day.
  The station's values are compared as the file states them, so only a column in the variable's own
  unit is compared: the station's pressure is in hPa and the product's in kPa, so pressure is not.
- `notes`, `correction_note` - the site's own account of the variable, shown on its page.

The two input files sit in the CH-LAE data folder, outside this repository; the defaults below are
where they are on the author's machine. The bundled extract in `examples/data/` is the older
six-column cut and carries none of the flags this example reads.
"""

import argparse
import sys
import webbrowser
from pathlib import Path

import fluxatlas as fa

# A unit carries superscripts, and a legacy Windows console code page cannot encode them.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

HERE = Path(__file__).parent
OUT = HERE / "output"
DATA_ROOT = Path(r"F:\Sync\luhk_work\dev-data\datasets-data\dataset_ch-lae_flux_product-data"
                 r"\workflow\10_METEO")
INPUT = DATA_ROOT / "30_PRODUCTS" / "99_METEO_MERGED_2004-2026.09.parquet"
REFERENCE_FILE = DATA_ROOT / "10_REFERENCE" / "MeteoSwiss_LAE_30MIN_2004-2026.09.parquet"

SITE = "CH-LAE"
SITE_LONG = "Lägeren, Switzerland — mixed forest"
SITE_LAT = 47.478333
SITE_LON = 8.364389
UTC_OFFSET = 1          # the product is stored in CET, winter time, all year round

# The first whole year of the tower record. 2004 is incomplete for most series, and the partial
# 2026 is dropped by the reader because it does not reach December.
FIRST_YEAR = 2005

# The reference station, and how its stamps meet the product's. The station file is stamped at the
# end of each half-hour and the product at its middle; a quarter of an hour back puts the station on
# the product's windows.
REFERENCE = dict(file=REFERENCE_FILE, station="MeteoSwiss Lägeren", distance_km=2.5,
                 elevation_m=845, shift=-15)

# ----------------------------------------------------------------------------------------------
# Legends. Each code maps to a long label, for the page's legends, and a short one, for where
# space is tight. Taken from the CH-LAE dashboard registry and the merged file's INFO.
# ----------------------------------------------------------------------------------------------

# TA, RH and VPD come from one probe, so their source flags are the same flag.
PROBE_SOURCE = {
    0: ("Campbell CS215, SDI-12 (from 21 Jan 2016)", "CS215"),
    1: ("Rotronic MP101A, analog (to 31 Dec 2015)", "MP101A"),
    2: ("acquisition changeover, era undetermined", "changeover"),
    3: ("before the tower record begins", "before record"),
    4: ("Campbell HygroVUE10", "HygroVUE10"),
    5: ("probe being handled", "probe handled"),
    6: ("Campbell CS215, after handling", "CS215 after handling"),
    7: ("Campbell CS215, heated", "CS215 heated"),
}

TA_FILL = {
    0: ("measured", "measured"),
    1: ("XGBoost model", "XGBoost"),
    2: ("timestamp-only fallback model", "timestamp-only"),
    4: ("linear interpolation (short gap)", "interpolated"),
    5: ("reconstructed from NABEL at 49 m", "NABEL 49 m"),
}

SW_IN_FILL = {
    0: ("observed", "observed"),
    1: ("daytime gap, XGBoost model", "XGBoost"),
    2: ("daytime gap, timestamp-only fallback model", "timestamp-only"),
    3: ("nighttime gap, set to zero by physics", "night zero"),
    4: ("linear interpolation (short gap)", "interpolated"),
}

PPFD_IN_FILL = {
    0: ("observed", "observed"),
    1: ("XGBoost model", "XGBoost"),
    2: ("timestamp-only fallback model", "timestamp-only"),
    3: ("nighttime gap, set to zero by physics", "night zero"),
    4: ("linear interpolation (short gap)", "interpolated"),
}

RH_FILL = {
    0: ("measured at 47 m (corrected)", "measured"),
    1: ("missing, never measured", "never measured"),
    2: ("missing, removed here as faulty", "removed as faulty"),
    3: ("reconstructed from NABEL at 49 m", "NABEL 49 m"),
    4: ("reconstructed from MeteoSwiss Lägeren", "MeteoSwiss LAE"),
}

VPD_FILL = {
    0: ("computed from measured TA and RH", "measured"),
    5: ("computed from measured RH and gap-filled TA", "gap-filled TA"),
    6: ("computed from RH reconstructed from NABEL at 49 m", "RH from NABEL"),
    7: ("computed from RH reconstructed from MeteoSwiss Lägeren", "RH from MeteoSwiss"),
}

PREC_FILL = {
    0: ("measured at the tower", "measured"),
    1: ("filled from MeteoSwiss OED, scaled by the monthly factor", "from OED"),
    2: ("still missing, no sub-daily reference exists", "still missing"),
}

PREC_SOURCE = {
    0: ("not measured at the tower", "not measured"),
    1: ("EMPA acquisition, to 28 May 2018, catches about 0.79 of the reference", "EMPA"),
    2: ("transition, acquisition unresolved (2018)", "transition"),
    3: ("ETH logger, Aug–Dec 2018", "ETH 2018"),
    4: ("ETH logger, 2019 to 1 Jan 2020 (MeteoScreeningTool)", "ETH 2019"),
    5: ("ETH logger, 2020–2025 (diive)", "ETH 2020+"),
}

LW_IN_SOURCE = {
    0: ("CNR4 on its own calibration factor", "CNR4"),
    1: ("CNR1 at the pyrgeometer's own sensitivity", "CNR1"),
    2: ("CNR1 at the pyranometer factor, reads low", "CNR1 (low)"),
    3: ("changeover, era undetermined", "changeover"),
}

SW_OUT_SOURCE = {
    0: ("CNR4, each shortwave channel on its own constant (from 7 Jan 2022)", "CNR4"),
    1: ("CNR1, one constant for all four channels of the head (to 14 Dec 2021)", "CNR1"),
    2: ("changeover, conversion in force not established", "changeover"),
}

LW_OUT_SOURCE = {
    0: ("CNR4 on its own calibration factor (from 7 Jan 2022)", "CNR4"),
    1: ("CNR1, logger program of 7 Jun 2016 onwards", "CNR1 (2016 program)"),
    2: ("CNR1 at the pyranometer factor (to 6 Jun 2016)", "CNR1 (pyranometer factor)"),
    3: ("changeover, calibration undetermined", "changeover"),
}

SWC_SOURCE = {
    0: ("no measurement (gap, or before this depth's record begins)", "no measurement"),
    1: ("EC-20 / M5 profile, MeteoScreeningTool screening (from 2004)", "EC-20"),
    2: ("TEROS 12 FF1 profile, installed 19 Mar 2020, diive screening", "TEROS 12"),
    3: ("TEROS 12 replacement probe, 40 cm downslope (0.3 m only, from 2025)",
        "TEROS replacement"),
}

TS_METHOD = {
    0: ("no value", "no value"),
    1: ("measured, current profile (from 10 Apr 2020)", "current profile"),
    2: ("measured, early profile (2004 to Mar 2021)", "early profile"),
    3: ("modelled from the other depths, nearest one within 0.15 m", "modelled (near)"),
    4: ("modelled from the other depths, nearest one further off", "modelled (far)"),
}

# ----------------------------------------------------------------------------------------------
# The variables
# ----------------------------------------------------------------------------------------------

VARIABLES = {
    "TA": dict(
        column="TA_T1_47_1_HOMOGENIZED_gfXG", raw="TA_T1_47_1_gfXG",
        qc="FLAG_TA_T1_47_1_ISFILLED", qc_legend=TA_FILL,
        source=dict(column="FLAG_TA_T1_47_1_SOURCE", legend=PROBE_SOURCE, reference_code=0),
        reference=dict(column="TA_LAE_MS", split=True),
        notes=[
            "Air temperature measured at 47 m on the tower, gap-filled and homogenised across the "
            "January 2016 sensor change. This is the column to use for anything that compares one "
            "year with another.",
            "The split of the reference comparison into night and day is the point of it. The "
            "constant was derived at night, where a radiation-shield error cannot contribute, and "
            "the shield term was derived against the aspirated NABEL sensor and acts only in "
            "sunlight, so the night residual tests the first and the day residual the second.",
        ],
        correction_note=(
            "The 47 m record spans two instruments: a Rotronic MP101A on an analog chain to "
            "31 Dec 2015 and a Campbell CS215 on SDI-12 from {break_ts}. The old chain carried a "
            "zero-point error and read about 1.3 {units} too cold, and the two sensors' radiation "
            "shields differ, which acts in daylight only. The homogenisation raises the earlier era "
            "by {offset} and removes up to {shield_max} of radiation-shield excess from the later "
            "one. These figures are measured from the file on every build."),
    ),
    "SW_IN": dict(
        column="SW_IN_T1_47_1_gfXG", qc="FLAG_SW_IN_T1_47_1_ISFILLED", qc_legend=SW_IN_FILL,
        notes=[
            "The tower record begins on 14 September 2005, so this variable starts with the first "
            "complete year, 2006. The series was tested at both hardware changes, the 2016 logger "
            "replacement and the December 2021 CNR1 to CNR4 swap, and steps at neither.",
            "Two changes in this record are documented rather than corrected: the tower "
            "pyranometer rises about 3 % from 2013, and neither hardware change moves the series. "
            "Both develop over years rather than stepping at a date, so there is no boundary at "
            "which a correction could be applied.",
            "There is deliberately no comparison against the MeteoSwiss station for this "
            "variable. Radiation errors are multiplicative, so radiation has to be compared in "
            "ratios under controls for season, illumination and how sunny the year was; and the "
            "station's own instrumentation was rebuilt on 6 October 2010.",
        ],
    ),
    "PPFD_IN": dict(
        column="PPFD_IN_T1_47_1_gfXG", qc="FLAG_PPFD_IN_T1_47_1_ISFILLED", qc_legend=PPFD_IN_FILL,
        notes=[
            "This sensor has been falling about 7 % since 2021. The drift is documented rather than "
            "corrected: it develops over years rather than stepping at a date, and no fieldbook "
            "entry names a cause.",
        ],
    ),
    "RH": dict(
        column="RH_T1_47_1", qc="FLAG_RH_T1_47_1_MISSING", qc_legend=RH_FILL,
        source=dict(column="FLAG_RH_T1_47_1_SOURCE", legend=PROBE_SOURCE, reference_code=0),
        reference=dict(column="RH_LAE_MS", split=True),
        notes=[
            "Relative humidity at 47 m, corrected and with the damaged periods removed. Records "
            "that could not be measured are reconstructed from a co-located sensor rather than "
            "modelled; the fill flag says which.",
        ],
    ),
    "PA": dict(
        column="PA_T1_47_1",
        notes=[
            "Air pressure at 47 m, exported as measured. There is no gap-filling and no "
            "correction, so the record carries its gaps.",
            "The reference station sits about 160 m above the tower, so a constant offset is "
            "expected. What matters is whether that offset stays constant.",
        ],
    ),
    "LW_IN": dict(
        column="LW_IN_T1_47_1",
        source=dict(column="FLAG_LW_IN_T1_47_1_SOURCE", legend=LW_IN_SOURCE, reference_code=0),
        notes=[
            "Incoming longwave radiation at 47 m, exported as measured with its gaps. The source "
            "flag names the pyrgeometer era, including the period in which the CNR1 was read with "
            "the pyranometer's calibration factor and therefore reads low.",
            "No weather service near the site measures longwave, so this variable has no external "
            "reference. The source flag is what carries its provenance.",
        ],
    ),
    "VPD": dict(
        column="VPD_T1_47_1", qc="FLAG_VPD_T1_47_1_ISFILLED", qc_legend=VPD_FILL,
        source=dict(column="FLAG_VPD_T1_47_1_SOURCE", legend=PROBE_SOURCE, reference_code=0),
        notes=[
            "Vapour pressure deficit at 47 m, computed by formula from the air temperature and "
            "relative humidity products. Its fill flag says what each record was computed from "
            "rather than how it was filled.",
            "VPD inherits the January 2016 sensor change of both its inputs. Relative humidity "
            "enters uncorrected, and the step VPD is left with is about 17 % of its mean.",
        ],
    ),
    "PREC": dict(
        column="PREC_TOT_T1_47_1_HOMOGENIZED", raw="PREC_TOT_T1_47_1",
        qc="FLAG_PREC_TOT_T1_47_1_ISFILLED", qc_legend=PREC_FILL,
        source=dict(column="FLAG_PREC_TOT_T1_47_1_SOURCE", legend=PREC_SOURCE),
        correction_note=(
            "The gauge was read by two acquisition systems either side of 2018, and the earlier one "
            "catches about 0.79 of what the reference does. The homogenised column rescales that "
            "earlier era onto the later one; the source flag names which chain produced each "
            "record, and the 71-day transition in 2018 has its own code."),
    ),
    "G": dict(
        column="G_FF1_0.05_HOMOGENIZED",
        notes=[
            "Soil heat flux at 0.05 m in the forest-floor profile, reconciled across the "
            "acquisition changes of 2012 and 2021 and exported with its gaps. Positive values are "
            "heat moving down into the soil. The column is the average of the two plates that "
            "reach the modern acquisition, each put onto that acquisition's scale and zero point.",
            "The correction has two terms, both fitted on climatology: a multiplicative gain per "
            "calendar month, which puts the three acquisition setups on one scale, and one additive "
            "constant per setup, which puts the zero point where a year of soil heat flux at a few "
            "centimetres has to average, near zero.",
            "Three times in the early record a plate reversed its sign and kept measuring. Those "
            "records carry source flag 5 in the product file and are excluded from this column.",
        ],
    ),
    "SW_OUT": dict(
        column="SW_OUT_T1_47_1",
        source=dict(column="FLAG_SW_OUT_T1_47_1_INSTRUMENT", legend=SW_OUT_SOURCE,
                    reference_code=0),
        notes=[
            "Reflected shortwave radiation at 47 m, exported as measured with its gaps. The stand "
            "reflects roughly a tenth of the shortwave that falls on it: the median albedo against "
            "<code>SW_IN</code> is 0.112.",
            "The December 2021 radiometer change is flagged rather than corrected. The albedo moves "
            "by about 4 % across the change, less than it moves from one year to the next. Filter "
            "on the instrument flag before comparing values across December 2021.",
        ],
    ),
    "LW_OUT": dict(
        column="LW_OUT_T1_47_1",
        source=dict(column="FLAG_LW_OUT_T1_47_1_SOURCE", legend=LW_OUT_SOURCE, reference_code=0),
        notes=[
            "Outgoing longwave radiation at 47 m, exported as measured with its gaps. It is the "
            "thermal emission of the canopy plus the small part of the downwelling flux the canopy "
            "reflects, so it stays at several hundred {units} day and night.",
            "Two documented changes step this record, and neither is corrected: the logger program "
            "of June 2016 changed the calibration factor of this channel, and the record steps "
            "again at the December 2021 radiometer exchange. The source flag separates the three "
            "eras.",
        ],
    ),
}

# Soil water content at five depths. Only 0.5 m has a single sensor era and therefore no
# homogenised column, and its record begins in April 2020.
for depth in ("0.05", "0.1", "0.2", "0.3", "0.5"):
    homogenised = depth != "0.5"
    VARIABLES[f"SWC@{depth}"] = dict(
        column=f"SWC_FF1_{depth}_1_HOMOGENIZED" if homogenised else f"SWC_FF1_{depth}_1",
        raw=f"SWC_FF1_{depth}_1" if homogenised else None,
        title=f"Soil water content at {depth} m", short=f"Soil water {depth} m",
        source=dict(column=f"FLAG_SWC_FF1_{depth}_1_SOURCE", legend=SWC_SOURCE, reference_code=2),
        correction_note=(
            "The record spans two sensor generations with no overlap between them, so the step at "
            "the changeover cannot be calibrated away against a common period. The homogenised "
            "column rescales the earlier generation on climatology, and the source flag names the "
            "sensor set behind every record." if homogenised else None),
        notes=None if homogenised else [
            "This depth has a single sensor era, installed in April 2020, so it begins then and "
            "carries no homogenised second column."],
    )

# Soil temperature at seven depths. The METHOD flag is both flags at once: whether a value was
# measured or modelled, and which profile measured it. The depths do not share a period, because
# the holes in the ground do not; each shows the years it has no value in as missing.
for depth in ("0.05", "0.1", "0.15", "0.2", "0.3", "0.5", "0.6"):
    flag = f"FLAG_TS_FF1_{depth}_HOMOGENIZED_GAPFILLED_METHOD"
    notes = []
    if depth in ("0.05", "0.1", "0.3", "0.5"):
        notes.append("Levels cross April 2020; amplitudes do not. The early sensors were far better "
                     "coupled to the surface than today's at the same nominal depth, so a daily or "
                     "seasonal amplitude computed across the changeover is dominated by the sensor "
                     "change rather than by climate. Annual and daily means are comparable.")
    if depth in ("0.3", "0.5"):
        notes.append("Roughly half of this depth is modelled: its early sensor stopped in March "
                     "2010 and the current one went in ten years later, so the decade between is "
                     "filled from the other depths.")
    if depth in ("0.5", "0.6"):
        notes.append("The sensors at this depth report to 0.1 {units}, and the median summer daily "
                     "amplitude here is one such step.")
    VARIABLES[f"TS@{depth}"] = dict(
        column=f"TS_FF1_{depth}_HOMOGENIZED_GAPFILLED",
        title=f"Soil temperature at {depth} m", short=f"Soil temperature {depth} m",
        qc=flag, qc_legend=TS_METHOD, measured_codes=(1, 2),
        source=dict(column=flag, legend=TS_METHOD),
        notes=notes,
    )

# Which depth stands in for soil water content in the composite, the badges and the grid's soil
# metric. The other depths have their own pages and their own metrics.
PRIMARY = {"SWC": "SWC@0.2"}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=INPUT, help="the merged CH-LAE product")
    parser.add_argument("--reference", type=Path, default=REFERENCE_FILE,
                        help="the MeteoSwiss Lägeren 30-minute file")
    parser.add_argument("--out", type=Path, default=OUT, help="output directory")
    parser.add_argument("--open", dest="open_browser", action="store_true",
                        help="open the finished page in the default browser")
    parser.add_argument("--no-hourly", action="store_true",
                        help="leave out the hourly arrays behind the day panel's diurnal charts")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"the merged CH-LAE product was not found at {args.input}; pass --input")
    reference = None
    variables = VARIABLES
    if args.reference.exists():
        reference = dict(REFERENCE, file=args.reference)
    else:
        print(f"reference file not found at {args.reference}; the comparison is left out")
        variables = {k: {f: x for f, x in v.items() if f != "reference"}
                     for k, v in VARIABLES.items()}

    args.out.mkdir(parents=True, exist_ok=True)
    atlas = fa.Atlas(args.input, variables, site=SITE, site_long=SITE_LONG,
                     first_year=FIRST_YEAR, primary=PRIMARY, lat=SITE_LAT, lon=SITE_LON,
                     utc_offset=UTC_OFFSET, reference=reference, hourly=not args.no_hourly)
    path = atlas.write(args.out / "CH-LAE_atlas.html")
    if args.open_browser:
        webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
