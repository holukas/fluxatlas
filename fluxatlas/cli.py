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

The site settings - a source flag, a fill legend, measured codes, an uncorrected twin, a variable's
own years, notes, the instance that stands in for a plain key, and a reference station - each name
a variable already in the selection. None of them is needed, and a build that names none of them
produces the page it always did. Legends are long, so they come from a JSON or YAML file:

    {"TA": {"source": {"0": ["Campbell CS215", "CS215"], "1": ["Rotronic MP101A", "MP101A"]},
            "qc": {"1": ["XGBoost model", "XGBoost"]}}}

A thin wrapper over `fluxatlas.atlas`, deliberately: nothing is computed here that a caller using
the library would have to reimplement.
"""

from __future__ import annotations

import argparse
import json
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
        if not _variables.is_known(key):
            raise SystemExit(f"{flag}: unknown variable {key!r}; known keys: "
                             f"{', '.join(_variables.known())}, or an instance of one written "
                             f"BASE@LABEL")
        if not value:
            raise SystemExit(f"{flag}: no value given for {key}")
        out[key] = value
    return out


def build_mapping(args):
    """The `variables` argument for `Atlas`, from the three flags that can contribute to it.

    Returns None where the caller named nothing, which is the signal to build the registry's
    default variables the file can supply.
    """
    explicit = _pairs(args.var, "--var")
    flags = _pairs(args.qc, "--qc")
    factors = _pairs(args.factor, "--factor")

    listed = []
    for chunk in args.vars or ():
        listed.extend(k.strip() for k in chunk.split(",") if k.strip())
    unknown = [k for k in listed if not _variables.is_known(k)]
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

    add_settings(args, mapping)
    return mapping or None


def _settings_of(mapping, key, flag):
    """The settings of a selected variable, made a dict where it was named by its key alone."""
    if key not in mapping:
        raise SystemExit(f"{flag} names {key}, which is not in the selection; name it with --vars "
                         f"or --var as well")
    if not isinstance(mapping[key], dict):
        mapping[key] = {}
    return mapping[key]


def _codes(text, flag, key):
    try:
        return [int(c) for c in text.split(",") if c.strip()]
    except ValueError:
        raise SystemExit(f"{flag}: {text!r} for {key} is not a list of integer codes") from None


def read_legends(path):
    """A legend file as `{key: {"source": legend, "qc": legend}}`, from JSON or YAML."""
    path = Path(path)
    if not path.exists():
        raise SystemExit(f"--legends: no such file: {path}")
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".yaml", ".yml"):
        try:
            import yaml
        except ImportError:
            raise SystemExit("--legends: a YAML file needs PyYAML (pip install pyyaml); a JSON "
                             "file needs nothing") from None
        found = yaml.safe_load(text)
    else:
        try:
            found = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"--legends: {path.name} is not valid JSON: {exc}") from None
    if not isinstance(found, dict):
        raise SystemExit(f"--legends: {path.name} should map variable keys to their legends")
    for key, entry in found.items():
        if not isinstance(entry, dict) or set(entry) - {"source", "qc"}:
            raise SystemExit(f"--legends: the entry for {key} takes 'source' and 'qc'")
    return found


def add_settings(args, mapping):
    """Write the site settings onto the variables of the selection they name."""
    # Read through `getattr`, so a namespace built without these flags - by a caller of
    # `build_mapping` that knows only the column flags - names none of them.
    args = argparse.Namespace(**{name: getattr(args, name, None) for name in (
        "source", "source_ref", "legends", "measured", "raw", "years", "note",
        "correction_note", "ref", "ref_split", "ref_factor")})
    for key, column in _pairs(args.source, "--source").items():
        _settings_of(mapping, key, "--source")["source"] = dict(column=column)
    for key, code in _pairs(args.source_ref, "--source-ref").items():
        spec = _settings_of(mapping, key, "--source-ref")
        if not isinstance(spec.get("source"), dict):
            raise SystemExit(f"--source-ref names {key}, which has no --source flag")
        spec["source"]["reference_code"] = _codes(code, "--source-ref", key)[0]
    if args.legends:
        for key, entry in read_legends(args.legends).items():
            spec = _settings_of(mapping, key, "--legends")
            if "source" in entry:
                if not isinstance(spec.get("source"), dict):
                    raise SystemExit(f"--legends gives a source legend for {key}, which has no "
                                     f"--source flag")
                spec["source"]["legend"] = entry["source"]
            if "qc" in entry:
                spec["qc_legend"] = entry["qc"]
    for key, codes in _pairs(args.measured, "--measured").items():
        _settings_of(mapping, key, "--measured")["measured_codes"] = _codes(codes, "--measured",
                                                                            key)
    for key, column in _pairs(args.raw, "--raw").items():
        _settings_of(mapping, key, "--raw")["raw"] = column
    for key, span in _pairs(args.years, "--years").items():
        first, sep, last = span.partition(":")
        if not sep:
            raise SystemExit(f"--years: {span!r} for {key} is not FIRST:LAST")
        try:
            years = [int(x) if x.strip() else None for x in (first, last)]
        except ValueError:
            raise SystemExit(f"--years: {span!r} for {key} is not FIRST:LAST") from None
        spec = _settings_of(mapping, key, "--years")
        spec["first_year"], spec["last_year"] = years
    for item in args.note or ():
        key, _, text = item.partition("=")
        if not _variables.is_known(key.strip()) or not text.strip():
            raise SystemExit(f"--note expects KEY=TEXT, got {item!r}")
        _settings_of(mapping, key.strip(), "--note").setdefault("notes", []).append(text.strip())
    for key, text in _pairs(args.correction_note, "--correction-note").items():
        _settings_of(mapping, key, "--correction-note")["correction_note"] = text
    for key, column in _pairs(args.ref, "--ref").items():
        _settings_of(mapping, key, "--ref")["reference"] = dict(column=column)
    for key in args.ref_split or ():
        spec = _settings_of(mapping, key.strip(), "--ref-split")
        if not isinstance(spec.get("reference"), dict):
            raise SystemExit(f"--ref-split names {key}, which has no --ref column")
        spec["reference"]["split"] = True
    for key, value in _pairs(args.ref_factor, "--ref-factor").items():
        spec = _settings_of(mapping, key, "--ref-factor")
        if not isinstance(spec.get("reference"), dict):
            raise SystemExit(f"--ref-factor names {key}, which has no --ref column")
        try:
            spec["reference"]["factor"] = float(value)
        except ValueError:
            raise SystemExit(f"--ref-factor: {value!r} is not a number") from None


def reference_of(args):
    """The reference station, from the flags that describe it, or None."""
    if not args.reference:
        if args.ref:
            raise SystemExit("--ref names a reference column, but no --reference file is given")
        return None
    return dict(file=args.reference, station=args.ref_station, distance_km=args.ref_distance,
                elevation_m=args.ref_elevation, shift=args.ref_shift)


def primary_of(args):
    """`--primary BASE=INSTANCE` as a dict, or None."""
    out = {}
    for item in args.primary or ():
        base, _, chosen = item.partition("=")
        if not base.strip() or not chosen.strip():
            raise SystemExit(f"--primary expects BASE=INSTANCE, got {item!r}")
        out[base.strip()] = chosen.strip()
    return out or None


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
    # Sized to what the file supplies rather than fixed: a computed net radiation names its formula
    # where a column would be, twice as long as any column name, and a fixed width let it push the
    # rest of its row out of line.
    wcol = max([len("column")] + [len(s["column"]) for s in found.values()])
    wqc = max([len("quality flag")] + [len(s["qc"] or "-") for s in found.values()])
    say(f"  {'variable':<9} {'column':<{wcol}}  {'quality flag':<{wqc}}  unit")
    asked = []
    for key, spec in found.items():
        factor = "" if spec["factor"] == 1.0 else f"  (x{spec['factor']:g})"
        mark = "" if _variables.default(key) else "  *"
        if mark:
            asked.append(key)
        say(f"  {key:<9} {spec['column']:<{wcol}}  {spec['qc'] or '-':<{wqc}}  "
            f"{spec['units']}{factor}{mark}")
    if asked:
        say()
        say("  * built only when named with --vars, which then names the whole selection. The")
        say("    energy-balance closure needs H, LE, NETRAD and G in the same build.")
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
  fluxatlas record.parquet -o atlas.html --var TA=air_temp --qc TA=TA_FLAG
  fluxatlas record.parquet -o atlas.html --var VPD=vpd_pa --factor VPD=0.001
  fluxatlas record.parquet -o atlas.html --var TA=air --source TA=TA_SENSOR --legends l.json
  fluxatlas record.parquet -o atlas.html --var SWC@0.1=swc_10 --var SWC@0.3=swc_30 --primary SWC=SWC@0.1
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
    site = parser.add_argument_group(
        "site settings", "Each names a variable already in the selection. None is needed.")
    site.add_argument("--source", action="append", metavar="KEY=COLUMN",
                      help="a second flag naming the sensor, record or calibration behind each "
                           "value. It is shown per year and per span and gates nothing. "
                           "Repeatable.")
    site.add_argument("--source-ref", action="append", metavar="KEY=CODE",
                      help="the code of the source flag's reference era, which a correction and a "
                           "hardware change are measured against. Repeatable.")
    site.add_argument("--legends", metavar="FILE",
                      help="a JSON or YAML file giving, per variable, the legend of its source "
                           "flag ('source') and of its fill flag ('qc'): each code mapped to a long "
                           "and a short label. With a legend, every code the flag carries must "
                           "have an entry.")
    site.add_argument("--measured", action="append", metavar="KEY=CODES",
                      help="the fill-flag codes that mean measured, where that is not 0 alone, "
                           "e.g. --measured TS@0.1=1,2. Repeatable.")
    site.add_argument("--raw", action="append", metavar="KEY=COLUMN",
                      help="the uncorrected twin of a corrected series, read to show what the "
                           "correction did. Repeatable.")
    site.add_argument("--years", action="append", metavar="KEY=FIRST:LAST",
                      help="the years a variable is read over, inside the file's, for a series "
                           "that exists in part of the record; either side may be left empty. "
                           "Repeatable.")
    site.add_argument("--note", action="append", metavar="KEY=TEXT",
                      help="a note on a variable, shown on its page; {units} is filled in. "
                           "Repeatable.")
    site.add_argument("--correction-note", action="append", metavar="KEY=TEXT",
                      help="how a correction is described, with {break_ts}, {offset} and "
                           "{shield_max} filled from the figures. Repeatable.")
    site.add_argument("--primary", action="append", metavar="BASE=INSTANCE",
                      help="the instance that stands in for its plain key in the composite, the "
                           "badges and the grid, e.g. --primary SWC=SWC@0.2. Repeatable.")
    site.add_argument("--lat", type=float, help="site latitude, for the night and day split")
    site.add_argument("--lon", type=float, help="site longitude, for the night and day split")
    site.add_argument("--utc-offset", type=float, metavar="HOURS",
                      help="the hours the file's timestamps are ahead of UTC, e.g. 1 for CET")
    ref = parser.add_argument_group(
        "reference station", "A second half-hourly file the selected variables are compared "
                             "with.")
    ref.add_argument("--reference", metavar="FILE", help="the reference station's file")
    ref.add_argument("--ref", action="append", metavar="KEY=COLUMN",
                     help="the reference column a variable is compared with. Repeatable.")
    ref.add_argument("--ref-split", action="append", metavar="KEY",
                     help="split a comparison into night and day by the position of the sun; "
                          "needs --lat, --lon and --utc-offset. Repeatable.")
    ref.add_argument("--ref-factor", action="append", metavar="KEY=NUMBER",
                     help="multiply a reference column onto the variable's unit, e.g. 0.1 for "
                          "hPa to kPa. Repeatable.")
    ref.add_argument("--ref-shift", type=float, default=0.0, metavar="MINUTES",
                     help="move the reference stamps by this many minutes before they are put on "
                          "the half-hourly windows, e.g. -15 for a station stamped at the end of "
                          "its half-hour")
    ref.add_argument("--ref-station", metavar="NAME", help="the station's name for the page")
    ref.add_argument("--ref-distance", type=float, metavar="KM", help="its distance from the site")
    ref.add_argument("--ref-elevation", type=float, metavar="M", help="its elevation")
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
                  hourly=not args.no_hourly, quiet=args.quiet, seasons=args.seasons,
                  primary=primary_of(args), lat=args.lat, lon=args.lon,
                  utc_offset=args.utc_offset, reference=reference_of(args))
    out = Path(args.out) if args.out else source.parent / f"{atlas.site}_atlas.html"
    path = atlas.write(out, title=args.title, quiet=args.quiet)
    if args.open_browser:
        webbrowser.open(path.resolve().as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
