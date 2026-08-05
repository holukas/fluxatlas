"""Build an atlas from a real FLUXNET FULLSET file, fluxes and all.

    uv run python examples/build_oe2_flux_atlas.py
    uv run python examples/build_oe2_flux_atlas.py --open
    uv run python examples/build_oe2_flux_atlas.py --vars NEE,GPP,RECO
    uv run python examples/build_oe2_flux_atlas.py --out D:/somewhere/else

Writes **one** page, `CH-Oe2_atlas.html`, into `examples/output/` by default, which is not tracked.
Pass `--out` to write it somewhere outside the repository - a synced folder, say - which is worth
doing here, because a build of this record with the hourly layer on is around 6 MB.

Use `--vars` to narrow what goes on that page. It stays one file either way.

What this example is for
------------------------
It is the companion to `build_lae_meteo_atlas.py` and the opposite case. That one shows the
**explicit mapping**, because the CH-LAE columns were never named for FLUXNET. This one shows what
happens when they were: a FULLSET file needs no mapping at all, so the whole configuration is the
list of variables you want - or nothing, and the registry offers everything the file can supply.

It is also the flux example. `NEE`, `GPP` and `RECO` arrive as totals in g C m-2 rather than as
means of a rate, and `LE` and `H` as means in W m-2; the resolved column travels onto the page, so
which of a FULLSET's many NEE and partitioning variants produced a figure is never in doubt.

The data file
-------------
`examples/data/EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv` is a real FULLSET record for
the Oensingen cropland: 248 columns, 368,208 half-hours, 2004-2024, 552 MB. It is **not committed**
- it is far past what a repository should carry, and `.gitignore` excludes `examples/data/*.csv` so
it cannot be added by accident. Put your own FULLSET file there, or point `--input` at one
anywhere; any FLUXNET-named half-hourly file works, this one is only what the flux work was checked
against.
"""

import argparse
import webbrowser
from pathlib import Path

import fluxatlas as fa

HERE = Path(__file__).parent
DATA = HERE / "data" / "EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv"
OUT = HERE / "output"

SITE_LONG = "Oensingen, Switzerland — managed cropland"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=DATA,
                        help=f"the FLUXNET file to read; the default is {DATA.name}")
    parser.add_argument("--vars", help="comma-separated canonical variables for the first build; "
                                       "the default is everything the file can supply")
    parser.add_argument("--out", type=Path, default=OUT,
                        help="directory to write the pages into; the default is examples/output")
    parser.add_argument("--open", dest="open_browser", action="store_true",
                        help="open the finished pages in the default browser")
    parser.add_argument("--no-hourly", action="store_true",
                        help="leave out the hourly arrays behind the day panel's diurnal charts")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(
            f"input not found: {args.input}\n"
            f"This file is not committed - see the module docstring. Point --input at a "
            f"FLUXNET-standardized half-hourly file, or drop one into {DATA.parent}.")
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    # -- What the file carries -----------------------------------------------------------------
    # Answered from the header alone, so this returns in well under a second on a file of this
    # size rather than reading several hundred megabytes to find out.
    print("=" * 90)
    print(f"What {args.input.name} can supply")
    print("=" * 90)
    for key, spec in fa.available(args.input).items():
        factor = "" if spec["factor"] == 1.0 else f"  (x{spec['factor']:g})"
        print(f"  {key:<7} {spec['column']:<20} {spec['qc'] or '-':<20} "
              f"{spec['units']}{factor}")

    # -- One page, with everything the registry finds and no mapping at all ---------------------
    selection = [k.strip() for k in args.vars.split(",")] if args.vars else None
    print()
    print("=" * 90)
    print("Everything the file supplies" if selection is None
          else f"Selected: {', '.join(selection)}")
    print("=" * 90)
    atlas = fa.Atlas(args.input, selection, site_long=SITE_LONG, hourly=not args.no_hourly)
    path = atlas.write(out_dir / "CH-Oe2_atlas.html")

    print()
    print(f"{'metrics offered:':<24} {len(atlas.metrics):>3}")
    print(f"{'badge types earned:':<24} {sum(1 for n in atlas.badges.values() if n):>3}")

    if args.open_browser:
        webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
