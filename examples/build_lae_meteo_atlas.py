"""Build an atlas from the bundled CH-LAE meteo record.

    uv run python examples/build_lae_meteo_atlas.py
    uv run python examples/build_lae_meteo_atlas.py --open

Writes into `examples/output/`, which is not tracked.

What this example is for
------------------------
The bundled file is a real twenty-one-year half-hourly record, and its columns are named to the
CH-LAE convention rather than to FLUXNET's - `TA_T1_47_1_HOMOGENIZED_gfXG`, not `TA_F`. That makes
it the useful example rather than an awkward one: it shows the **explicit mapping**, which is how
the library reads any half-hourly series whose columns were never meant for it.

A file that does use FLUXNET names needs none of this. There, `variables=["TA", "PREC"]` is enough
and the columns are found by the registry:

    fa.build_atlas("FLX_CH-LAE_FLUXNET2015_FULLSET_HH_2005-2025.csv", "atlas.html",
                   variables=["TA", "PREC"])
"""

import argparse
import webbrowser
from pathlib import Path

import fluxatlas as fa

HERE = Path(__file__).parent
DATA = HERE / "data" / "CH-LAE_meteo_30min_2005-2025.parquet"
OUT = HERE / "output"

# Canonical key -> the column that supplies it, and the flag that says which records are measured.
# `qc` follows the FLUXNET convention the library assumes throughout: 0 is measured, anything above
# it is modelled. The CH-LAE ISFILLED flags happen to use the same convention, so they are passed
# straight through. Relative humidity and soil water carry no fill flag in this extract, so they
# are read as measured wherever they are present - which is all that can be concluded from them.
MAPPING = {
    "TA": dict(column="TA_T1_47_1_HOMOGENIZED_gfXG", qc="FLAG_TA_T1_47_1_ISFILLED"),
    "PREC": dict(column="PREC_TOT_T1_47_1_HOMOGENIZED", qc="FLAG_PREC_TOT_T1_47_1_ISFILLED"),
    "SW_IN": dict(column="SW_IN_T1_47_1_gfXG", qc="FLAG_SW_IN_T1_47_1_ISFILLED"),
    "VPD": dict(column="VPD_T1_47_1", qc="FLAG_VPD_T1_47_1_ISFILLED"),
    "RH": dict(column="RH_T1_47_1"),
    "SWC": dict(column="SWC_FF1_0.2_1_HOMOGENIZED"),
}

SITE = "CH-LAE"
SITE_LONG = "Lägeren, Switzerland — mixed forest"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--open", dest="open_browser", action="store_true",
                        help="open the finished pages in the default browser")
    parser.add_argument("--no-hourly", action="store_true",
                        help="leave out the hourly arrays behind the day panel's diurnal charts")
    args = parser.parse_args()

    if not DATA.exists():
        raise SystemExit(f"example data not found: {DATA}")
    OUT.mkdir(exist_ok=True)
    written = []

    # -- The whole record, every variable ------------------------------------------------------
    print("=" * 90)
    print("Six variables")
    print("=" * 90)
    full = fa.Atlas(DATA, MAPPING, site=SITE, site_long=SITE_LONG, hourly=not args.no_hourly)
    written.append(full.write(OUT / "CH-LAE_atlas.html"))

    # -- One variable, to show what the selection decides ---------------------------------------
    # Everything that reads another variable is gone: the precipitation and radiation metrics are
    # not in the picker, the badges that need them are withheld with a reason attached, and the
    # composite - a statement about several axes at once - is not offered at all.
    print()
    print("=" * 90)
    print("Air temperature alone")
    print("=" * 90)
    ta = fa.Atlas(DATA, {"TA": MAPPING["TA"]}, site=SITE, site_long=SITE_LONG,
                  hourly=not args.no_hourly)
    written.append(ta.write(OUT / "CH-LAE_atlas_TA.html"))

    print()
    print(f"{'metrics offered:':<24} {len(full.metrics):>3} with six variables, "
          f"{len(ta.metrics):>3} with one")
    print(f"{'badge types earned:':<24} {sum(1 for n in full.badges.values() if n):>3} with six, "
          f"{sum(1 for n in ta.badges.values() if n):>3} with one")

    if args.open_browser:
        for path in written:
            webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
