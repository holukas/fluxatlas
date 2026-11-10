"""Build an atlas from the merged CH-LAE meteo product, with every site setting the package offers.

    uv run python examples/build_lae_meteo_atlas.py
    uv run python examples/build_lae_meteo_atlas.py --input PATH/99_METEO_MERGED_2004-2026.09.parquet
                                                    --reference PATH/MeteoSwiss_LAE_30MIN_2004-2026.09.parquet
    uv run python examples/build_lae_meteo_atlas.py --open

Writes `CH-LAE_atlas.html` into `examples/output/`, which is not tracked. The same page is built
from the command line by

    fluxatlas --config examples/ch-lae_site.json

What this example is for
------------------------
A FLUXNET file needs none of this: its columns are named to a convention the registry already
knows, and `variables=["TA", "PREC"]` is enough. The CH-LAE merged product is the other case, and
the fuller one. Its columns are named to the site's own convention, its flags follow no FLUXNET
convention, it carries a second flag naming the sensor behind each value, several variables are
measured at several depths, the corrected series ship beside the measured ones, and the site keeps
a reference station two and a half kilometres away. Every one of those is a setting, and all of
them are in one settings file, `ch-lae_site.json` beside this script; none of it is in the package.
This script reads that file, lets the two input paths be overridden, and builds.

What each setting does
----------------------
- `column`, `qc` - which column supplies the variable, and its fill flag.
- `qc_legend`, `measured_codes` - what each fill code means, and which codes are measurements.
  Soil temperature's METHOD flag names the sensor generation as well as the fill, so two of its
  codes are measured.
- `source` - the second flag, with a legend and the code of the reference era. Air temperature,
  relative humidity and VPD come from one probe, so their source flags share a legend.
- `raw` - the uncorrected twin of a homogenised series, read only to show what the correction did.
- `SWC@0.05` and the like - one series per depth, each with its own page. Soil water at 0.5 m has a
  single sensor era, begins in April 2020 and has no homogenised column. The soil temperature
  depths do not share a period, because the holes in the ground do not; each shows the years it has
  no value in as missing.
- `primary` - `{"SWC": "SWC@0.2"}` says which depth stands in for soil water content in the
  composite, the badges and the grid's soil metric.
- `reference` - the station column a variable is compared with, and whether to split night from day.
  The station's values are compared as the file states them, so only a column in the variable's own
  unit is compared: the station's pressure is in hPa and the product's in kPa, so pressure is not.
  The station file is stamped at the end of each half-hour and the product at its middle, so a
  `shift` of a quarter of an hour back puts the station on the product's windows.
- `utc_offset` - the product is stored in CET, winter time, all year round.
- `first_year` - 2005, the first whole year of the tower record. 2004 is incomplete for most
  series, and the partial 2026 is dropped by the reader because it does not reach December.
- `notes`, `correction_note` - the site's own account of the variable, shown on its page.

The legends come from the CH-LAE dashboard registry and the merged file's INFO. The two input files
sit in the CH-LAE data folder, outside this repository; the settings file names where they are on
the author's machine. The bundled extract in `examples/data/` is the older six-column cut and
carries none of the flags this example reads.
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
SETTINGS = HERE / "ch-lae_site.json"


def main():
    settings = fa.read_config(SETTINGS)

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=settings["path"],
                        help="the merged CH-LAE product")
    parser.add_argument("--reference", type=Path, default=settings["reference"]["file"],
                        help="the MeteoSwiss Lägeren 30-minute file")
    parser.add_argument("--out", type=Path, default=settings["out"].parent,
                        help="output directory")
    parser.add_argument("--open", dest="open_browser", action="store_true",
                        help="open the finished page in the default browser")
    parser.add_argument("--no-hourly", action="store_true",
                        help="leave out the hourly arrays behind the day panel's diurnal charts")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"the merged CH-LAE product was not found at {args.input}; pass --input")
    overrides = dict(path=args.input, out=args.out / settings["out"].name)
    if args.no_hourly:
        overrides["hourly"] = False
    if args.reference.exists():
        overrides["reference"] = dict(settings["reference"], file=args.reference)
    else:
        print(f"reference file not found at {args.reference}; the comparison is left out")
        overrides["reference"] = None
        overrides["variables"] = {k: {f: x for f, x in v.items() if f != "reference"}
                                  for k, v in settings["variables"].items()}

    atlas = fa.Atlas.from_config(SETTINGS, **overrides)
    path = atlas.write()
    if args.open_browser:
        webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
