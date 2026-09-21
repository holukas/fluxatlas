"""Build an atlas from a FLUXNET-standardized file. The ordinary case, and the place to start.

    uv run python examples/build_fluxnet_atlas.py --input YOUR_FULLSET.csv --open

A FLUXNET file needs no configuration. Its columns are named to a convention the registry already
knows, so `Atlas(path)` reads it unaided: no mapping, no column names, no units. That is what this
example is for, and it is why it is the shorter of the two.

Everything past the first build is optional. The script shows, in order:

  1. what the file can supply, from the header alone;
  2. the default build - one call, nothing configured;
  3. the same build with the options that are worth knowing, each printed beside the flag and the
     keyword argument that set it.

Run it against your own record with `--input`. The default path below is the file the flux work was
developed against, and it is **not committed**: a FULLSET record is hundreds of megabytes, and
`.gitignore` excludes `examples/data/*.csv` so one cannot be added by accident.

It writes **one** page. Pass `--out` to put it somewhere outside the repository - a synced folder,
say - which is worth doing on a record of any length, because a page with the hourly layer on runs
to several megabytes.

The companion example is `build_lae_meteo_atlas.py`, the opposite case: a local product whose
columns were never named for FLUXNET, and so has to be mapped by hand. Between them they cover
every file this package reads.
"""

import argparse
import sys
import webbrowser
from pathlib import Path

import fluxatlas as fa

HERE = Path(__file__).parent
DATA = HERE / "data" / "EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv"
OUT = HERE / "output"

RULE = "=" * 90


def main():
    # The same reconfiguration `fluxatlas.cli.main` does, and for the same reason: units carry
    # superscripts, a legacy Windows console code page cannot encode them, and a script that owns
    # its process may fix that where the library may not. Without it this example dies on the
    # first `W m⁻²` it prints.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # a redirected stream may not support it
        pass

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=DATA,
                        help=f"the FLUXNET file to read; the default is {DATA.name}")
    parser.add_argument("--vars", help="comma-separated canonical variables; the default is "
                                       "everything the file can supply")
    parser.add_argument("--out", type=Path, default=OUT,
                        help="directory to write the page into; the default is examples/output")
    parser.add_argument("--site-long", default="",
                        help="a longer description of the site, for the page header")
    parser.add_argument("--seasons", default="DJF",
                        help="the first season; the rest of the year follows in blocks of the same "
                             "length. 'none' drops the scale. Default: DJF")
    parser.add_argument("--first-year", type=int, help="first year to include")
    parser.add_argument("--last-year", type=int, help="last year to include")
    parser.add_argument("--no-hourly", action="store_true",
                        help="leave out the hourly arrays behind the day panel's diurnal charts, "
                             "which are most of the file size")
    parser.add_argument("--open", dest="open_browser", action="store_true",
                        help="open the finished page in the default browser")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(
            f"input not found: {args.input}\n"
            f"The default file is not committed - see the module docstring. Point --input at a "
            f"FLUXNET-standardized half-hourly file, or drop one into {DATA.parent}.")
    args.out.mkdir(parents=True, exist_ok=True)

    # -- 1. What the file carries ----------------------------------------------------------------
    # Answered from the header alone, so this returns in well under a second on a 552 MB file
    # rather than reading several hundred megabytes to find out. It is also what a variable picker
    # would be built on.
    print(RULE)
    print(f"1. What {args.input.name} can supply")
    print(RULE)
    for key, spec in fa.available(args.input).items():
        factor = "" if spec["factor"] == 1.0 else f"  (x{spec['factor']:g})"
        print(f"  {key:<7} {spec['column']:<20} {spec['qc'] or '-':<20} "
              f"{spec['units']}{factor}")
    print(f"\n  the command line prints the same: fluxatlas {args.input.name} --list")

    # -- 2. The default build --------------------------------------------------------------------
    # This is the whole of it. One path, and every variable the registry finds in the file, each
    # with its unit conversion, its quality flag and its aggregation taken from the registry.
    print()
    print(RULE)
    print("2. The default build: everything the file supplies, nothing configured")
    print(RULE)
    print(f"  fa.Atlas({args.input.name!r})")
    print(f"  fluxatlas {args.input.name} -o atlas.html")

    # -- 3. What can be set on top of it ---------------------------------------------------------
    # Each option is printed beside the flag that sets it, so the mapping between this script's
    # arguments, the `fluxatlas` command line and the `Atlas` keyword arguments is on screen rather
    # than implied. Everything here has a default that works; none of it has to be passed.
    selection = [k.strip() for k in args.vars.split(",")] if args.vars else None
    options = dict(
        variables=(selection, "--vars TA,NEE,GPP",
                   "a chosen selection is a page that answers a question; the default surveys "
                   "the file"),
        site_long=(args.site_long or None, "--site-long 'Oensingen, cropland'",
                   "a longer description of the site, for the page header"),
        seasons=(args.seasons if args.seasons != "DJF" else None, "--seasons DJFMAM",
                 "DJF gives the usual four seasons, DJFMAM two half-years, none drops the scale"),
        first_year=(args.first_year, "--first-year 2010", "narrow the record from the start"),
        last_year=(args.last_year, "--last-year 2020", "narrow the record from the end"),
        hourly=(False if args.no_hourly else None, "--no-hourly",
                "drop the diurnal arrays, which are most of the file size"),
    )
    print()
    print(RULE)
    print("3. What can be set on top of that")
    print(RULE)
    for name, (value, flag, why) in options.items():
        print(f"  {flag:<36} {name + '=':<12} {'default' if value is None else f'set to {value!r}'}")
        print(f"  {'':<36} {why}")

    # Only what was actually asked for is passed, so the library's defaults stay the library's. A
    # default copied into an example is a default that goes stale.
    kwargs = {name: value for name, (value, _, _) in options.items() if value is not None}
    variables = kwargs.pop("variables", None)
    print()
    print(RULE)
    print("Building, with nothing set" if not kwargs and variables is None else
          f"Building, with {', '.join(['variables'] * (variables is not None) + list(kwargs))} set")
    print(RULE)
    atlas = fa.Atlas(args.input, variables, **kwargs)

    path = atlas.write(args.out / f"{atlas.site}_atlas.html")

    print()
    print(f"{'metrics offered:':<24} {len(atlas.metrics):>3}")
    print(f"{'badge types earned:':<24} {sum(1 for n in atlas.badges.values() if n):>3}")

    if args.open_browser:
        webbrowser.open(path.resolve().as_uri())


if __name__ == "__main__":
    main()
