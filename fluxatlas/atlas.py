"""The public API: turn one FLUXNET file and a choice of variables into one atlas page.

    import fluxatlas as fa

    fa.available("CH-LAE_HH_2004-2025.csv")          # what the file can supply
    fa.build_atlas("CH-LAE_HH_2004-2025.csv", "atlas.html", variables=["TA"])

The selection is the whole interface. `variables=["TA"]` builds an atlas of air temperature and
nothing else: the metrics that read other variables are absent from the picker, the badges that
need them are withheld with a reason attached, and the composite - which is a statement about
several axes at once - is withheld rather than computed over one. Passing more variables adds
their metrics, badges and day tests back.

A CLI and a desktop GUI are planned on top of this module; both are meant to be thin, so anything
either of them would need belongs here rather than in them.
"""

from __future__ import annotations

import re
from pathlib import Path

from ._console import say
from . import build as _build
from . import io as _io
from . import variables as _variables

__all__ = ["Atlas", "build_atlas", "available", "known_variables"]

# A FLUXNET site identifier: two-letter country code, a hyphen, three characters. The boundaries
# are spelled out rather than written `\b`, because `_` is a word character and the identifier
# almost always arrives between underscores - `FLX_CH-LAE_FLUXNET2015_...`.
SITE_ID = re.compile(r"(?<![A-Za-z0-9])([A-Z]{2}-[A-Za-z0-9]{3})(?![A-Za-z0-9])")


def known_variables():
    """The canonical variable keys the registry describes."""
    return _variables.known()


def available(path):
    """Which registry variables `path` can supply, and the column each would come from."""
    return _io.available(path)


def _guess_site(path):
    """The site identifier out of the file name, where it carries one.

    FLUXNET file names lead with the site - `FLX_CH-LAE_FLUXNET2015_FULLSET_HH_...` - so reading it
    from there saves the caller stating what the file already says. It is only a default; anything
    passed for `site` wins.
    """
    match = SITE_ID.search(Path(path).stem)
    return match.group(1) if match else Path(path).stem[:20]


class Atlas:
    """One atlas: a file, a selection of variables, and the page they produce.

    Building the payload is the expensive step and happens once, on construction. `write` can then
    be called more than once - to a working copy and to a published location, say - without
    recomputing anything.
    """

    def __init__(self, path, variables=None, *, site=None, site_long="", first_year=None,
                 last_year=None, hourly=True, quiet=False, seasons=_build.DEFAULT_SEASONS):
        self.path = Path(path)
        self.site = site or _guess_site(path)
        self.site_long = site_long
        self.hourly = hourly
        self.seasons = seasons

        self.loaded = _io.read_fluxnet(self.path, variables, first_year=first_year,
                                       last_year=last_year, quiet=quiet)
        self.variables = list(self.loaded)
        self.first_year, self.last_year = _io.span(self.loaded)
        if not quiet:
            say(f"building {(self.last_year - self.first_year + 1) * 12} months, "
                f"{self.first_year}-{self.last_year}"
                f"{'' if hourly else ', without hourly detail'} ...")
        self.payload = _build.build_payload(
            self.loaded, site=self.site, site_long=self.site_long, source=self.path.name,
            with_hourly=hourly, quiet=quiet, seasons=seasons)
        if not quiet:
            self.report()

    @property
    def metrics(self):
        """The metrics this selection produced, as `(key, label)` pairs."""
        return [(m["key"], m["label"]) for m in self.payload["metrics"]]

    @property
    def badges(self):
        """Badge key to the number of months that earned it."""
        return {b["key"]: b["n"] for b in self.payload["badges"]}

    def report(self):
        """Print what the build found, including the trends that qualify every anomaly on it."""
        counted = sorted(((b["n"], b["label"]) for b in self.payload["badges"]), reverse=True)
        awarded = ", ".join(f"{label} {n}" for n, label in counted if n)
        say(f"  badges awarded: {awarded}" if awarded else "  no badges awarded")
        for m in self.payload["metrics"]:
            t = m.get("trend_year")
            if not t:
                continue
            if "slope" not in t:
                say(f"  trend {m['short']:<16} withheld, {t['n']} complete years")
                continue
            pvalue = "n/a" if t["p"] is None else f"{t['p']:.3f}"
            say(f"  trend {m['short']:<16} {t['slope']:+8.3f} {m['units']}/decade  "
                f"p = {pvalue}, {t['n']} years")

    def write(self, out_path, title=None, quiet=False):
        """Render the page to `out_path` and return the path written."""
        path = _build.render(self.payload, Path(out_path), title=title)
        if not quiet:
            say(f"  written: {path}  ({path.stat().st_size / 1024 / 1024:.1f} MB)")
        return path


def build_atlas(path, out, variables=None, *, site=None, site_long="", first_year=None,
                last_year=None, hourly=True, title=None, quiet=False,
                seasons=_build.DEFAULT_SEASONS):
    """Read, build and write in one call, returning the path written."""
    atlas = Atlas(path, variables, site=site, site_long=site_long, first_year=first_year,
                  last_year=last_year, hourly=hourly, quiet=quiet, seasons=seasons)
    return atlas.write(out, title=title, quiet=quiet)
