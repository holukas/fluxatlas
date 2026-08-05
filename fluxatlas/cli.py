"""Command line interface.

    fluxatlas INPUT --list
    fluxatlas INPUT -o atlas.html --vars TA,PREC
    fluxatlas INPUT -o atlas.html --var TA=TA_T1_47_1_HOMOGENIZED_gfXG --qc TA=FLAG_TA_ISFILLED

Two ways to say which variables to build, and they can be combined.

`--vars` names **canonical keys** and lets the registry find the columns, which works where the
file uses FLUXNET names (`TA_F`, `P_F`, `SW_IN_F`, ...). `--var KEY=COLUMN` names the column
outright, which is what a file with its own naming needs - and most real files have their own
naming. `--list` prints what the registry can find in a file, which is the way to discover whether
the first form will do before reaching for the second.

`--qc` and `--factor` refine a mapping. The quality flag follows the FLUXNET convention the whole
library assumes - 0 measured, above 0 modelled - and the factor converts the column into the
canonical unit, which is what `--list` prints beside each variable.

A thin wrapper over `fluxatlas.atlas`, deliberately: nothing is computed here that a caller using
the library would have to reimplement.
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from . import build as _build
from . import io as _io
from . import variables as _variables
from ._console import say
from .atlas import Atlas


def _pairs(values, flag):
    """`KEY=VALUE` arguments as a dict, with the key checked against the registry."""
    out = {}
    for item in values or ():
        if "=" not in item:
            raise SystemExit(f"{flag} expects KEY=VALUE, got {item!r}")
        key, _, value = item.partition("=")
        key, value = key.strip(), value.strip()
        if key not in _variables.VARIABLES:
            raise SystemExit(f"{flag}: unknown variable {key!r}; known keys: "
                             f"{', '.join(_variables.known())}")
        if not value:
            raise SystemExit(f"{flag}: no value given for {key}")
        out[key] = value
    return out


def build_mapping(args):
    """The `variables` argument for `Atlas`, from the three flags that can contribute to it.

    Returns None where the caller named nothing, which is the signal to build every variable the
    file can supply.
    """
    explicit = _pairs(args.var, "--var")
    flags = _pairs(args.qc, "--qc")
    factors = _pairs(args.factor, "--factor")

    listed = []
    for chunk in args.vars or ():
        listed.extend(k.strip() for k in chunk.split(",") if k.strip())
    unknown = [k for k in listed if k not in _variables.VARIABLES]
    if unknown:
        raise SystemExit(f"--vars: unknown variable(s) {', '.join(unknown)}; known keys: "
                         f"{', '.join(_variables.known())}")

    mapping = {key: None for key in listed}
    for key, column in explicit.items():
        mapping[key] = dict(column=column)

    for source, name, cast in ((flags, "qc", str), (factors, "factor", float)):
        for key, value in source.items():
            if not isinstance(mapping.get(key), dict):
                raise SystemExit(
                    f"--{name} names {key}, which has no --var mapping. The flag refines a column "
                    f"named with --var {key}=COLUMN.")
            try:
                mapping[key][name] = cast(value)
            except ValueError:
                raise SystemExit(f"--{name}: {value!r} is not a number") from None

    return mapping or None


def show(path):
    """Print what the registry can find in the file, and what it cannot."""
    found = _io.available(path)
    if not found:
        say(f"{Path(path).name} carries none of the registry variables under a name the registry "
            f"knows.")
        say("Name the columns yourself, e.g.:  --var TA=YOUR_TEMPERATURE_COLUMN")
        say(f"\nknown variables: {', '.join(_variables.known())}")
        return 0
    say(f"{Path(path).name}")
    say(f"  {'variable':<9} {'column':<22} {'quality flag':<22} unit")
    for key, spec in found.items():
        factor = "" if spec["factor"] == 1.0 else f"  (x{spec['factor']:g})"
        say(f"  {key:<9} {spec['column']:<22} {spec['qc'] or '-':<22} {spec['units']}{factor}")
    missing = [k for k in _variables.known() if k not in found]
    if missing:
        say(f"\n  not found: {', '.join(missing)}")
        say(f"  name the column yourself if the file has one, e.g. --var {missing[0]}=YOUR_COLUMN")
    return 0


def build_parser():
    """The argument parser, built apart from `main` so the documentation can render it.

    Nothing is parsed here and no stream is touched, so a documentation build gets the options and
    their help without running the command.
    """
    parser = argparse.ArgumentParser(
        prog="fluxatlas",
        description="Build an atlas page from a half-hourly FLUXNET-standardized file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""examples:
  fluxatlas record.csv --list
  fluxatlas record.csv -o atlas.html
  fluxatlas record.csv -o atlas.html --vars TA,PREC
  fluxatlas record.parquet -o atlas.html --var TA=Lufttemperatur --qc TA=TA_FLAG
  fluxatlas record.parquet -o atlas.html --var VPD=vpd_pascal --factor VPD=0.001
""")
    parser.add_argument("input", help="the half-hourly input file (.csv or .parquet)")
    parser.add_argument("-o", "--out", help="output HTML file; the default is <SITE>_atlas.html "
                                            "beside the input")
    parser.add_argument("--vars", action="append", metavar="KEY[,KEY...]",
                        help="canonical variables to build, with their columns found by the "
                             f"registry ({', '.join(_variables.known())}). Repeatable.")
    parser.add_argument("--var", action="append", metavar="KEY=COLUMN",
                        help="name the column that supplies a variable, for a file that does not "
                             "use FLUXNET names. Repeatable.")
    parser.add_argument("--qc", action="append", metavar="KEY=COLUMN",
                        help="the quality flag beside a --var column: 0 measured, above 0 "
                             "modelled. Repeatable.")
    parser.add_argument("--factor", action="append", metavar="KEY=NUMBER",
                        help="multiply a --var column onto the canonical unit, e.g. "
                             "--factor VPD=0.001 for Pa to kPa. Repeatable.")
    parser.add_argument("--seasons", default="DJF", metavar="MONTHS",
                        help="the first season, as month initials (DJF, JJA) or numbers (12,1,2). "
                             "The rest of the year is divided into seasons of the same length, so "
                             "DJF gives the usual four and DJFMAM gives two half-years. Use "
                             "'none' for a site whose year has no seasons. Default: DJF")
    parser.add_argument("--site", help="site identifier; the default is read from the file name")
    parser.add_argument("--site-long", default="", help="longer site description for the page")
    parser.add_argument("--first-year", type=int, help="first year to include")
    parser.add_argument("--last-year", type=int, help="last year to include")
    parser.add_argument("--no-hourly", action="store_true",
                        help="leave out the hourly arrays behind the day panel's diurnal charts, "
                             "which are most of the file size")
    parser.add_argument("--title", help="page title; the default names the site and the span")
    parser.add_argument("--list", action="store_true",
                        help="print the variables the registry can find in the file, and exit")
    parser.add_argument("--open", dest="open_browser", action="store_true",
                        help="open the finished page in the default browser")
    parser.add_argument("-q", "--quiet", action="store_true", help="print nothing but errors")
    return parser


def main(argv=None):
    # A CLI owns its own process, so reconfiguring the stream is fair here in a way it would not be
    # inside the library: units carry superscripts and a legacy console code page cannot encode
    # them. `say()` still covers the streams that cannot be reconfigured.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # a redirected stream may not support it
        pass

    args = build_parser().parse_args(argv)

    source = Path(args.input)
    if not source.exists():
        raise SystemExit(f"no such file: {source}")
    if args.list:
        return show(source)

    # Checked before the file is opened. The season spec is a string the caller typed, and a typo
    # in it should not cost a read of several hundred megabytes and a screen of coverage warnings
    # before it is mentioned.
    try:
        _build.season_scheme(args.seasons)
    except ValueError as exc:
        raise SystemExit(f"--seasons: {exc}") from None

    atlas = Atlas(source, build_mapping(args), site=args.site, site_long=args.site_long,
                  first_year=args.first_year, last_year=args.last_year,
                  hourly=not args.no_hourly, quiet=args.quiet, seasons=args.seasons)
    out = Path(args.out) if args.out else source.parent / f"{atlas.site}_atlas.html"
    path = atlas.write(out, title=args.title, quiet=args.quiet)
    if args.open_browser:
        webbrowser.open(path.resolve().as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
