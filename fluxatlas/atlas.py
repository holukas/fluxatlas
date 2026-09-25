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

import copy
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

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


def _fingerprint(path):
    """Size in bytes and SHA-256 digest of the file at `path`.

    The file is streamed through the hash in fixed-size chunks, so a FULLSET file of several
    hundred megabytes costs a buffer rather than its own size in memory. The whole file is hashed,
    not only the columns the atlas reads: a reprocessed file keeps its name, and the digest is what
    tells two releases apart.
    """
    with open(path, "rb") as handle:
        digest = hashlib.file_digest(handle, "sha256")
    return dict(bytes=Path(path).stat().st_size, sha256=digest.hexdigest())


# Which payload list holds the spans of each scale `Atlas.table` accepts.
_SCALES = {"month": "months", "season": "seasons", "year": "years"}

# The per-variable figures `Atlas.table` reads off a span row: payload field, column suffix. The
# suffixes are the ones the span statistics use, so `TA_anom` means the same thing in both places.
_TABLE_FIELDS = (("v", ""), ("a", "_anom"), ("z", "_z"), ("p", "_pctn"), ("r", "_rank"),
                 ("n", "_rank_n"), ("meas", "_meas"), ("avail", "_avail"), ("u", "_unc"))


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

        # The digest is taken on a second thread while the file is parsed. Hashing releases the
        # interpreter lock and reading the selected columns is mostly parsing, so the two overlap
        # and the digest adds little to the build instead of a second pass over the file after it.
        with ThreadPoolExecutor(max_workers=1) as pool:
            fingerprint = pool.submit(_fingerprint, self.path)
            self.loaded = _io.read_fluxnet(self.path, variables, first_year=first_year,
                                           last_year=last_year, quiet=quiet)
            fingerprint = fingerprint.result()
        self.variables = list(self.loaded)
        self.first_year, self.last_year = _io.span(self.loaded)
        if not quiet:
            say(f"building {(self.last_year - self.first_year + 1) * 12} months, "
                f"{self.first_year}-{self.last_year}"
                f"{'' if hourly else ', without hourly detail'} ...")
        self.payload = _build.build_payload(
            self.loaded, site=self.site, site_long=self.site_long, source=self.path.name,
            with_hourly=hourly, quiet=quiet, seasons=seasons, fingerprint=fingerprint)
        if not quiet:
            self.report()

    @property
    def provenance(self):
        """What produced this atlas, as the page records it in `meta["provenance"]`.

        A dict with the input file's name (`file`), its size in bytes (`bytes`) and its SHA-256
        digest (`sha256`); under `columns`, for each variable, the column it was read from, its
        quality flag column or None, and the factor applied onto the canonical unit; and the season
        specification, the first and last year and whether the hourly layer was built. FLUXNET
        files are reprocessed under an unchanged name, so the digest rather than the name is what
        identifies the input. The dict is a copy, so changing it does not change the page.
        """
        return copy.deepcopy(self.payload["meta"]["provenance"])

    @property
    def metrics(self):
        """The metrics this selection produced, as `(key, label)` pairs."""
        return [(m["key"], m["label"]) for m in self.payload["metrics"]]

    @property
    def badges(self):
        """Badge key to the number of months that earned it."""
        return {b["key"]: b["n"] for b in self.payload["badges"]}

    def table(self, scale="month"):
        """The figures behind the tiles of one scale, as a pandas DataFrame with one row per span.

        `scale` is `"month"`, `"season"` or `"year"`. Months are indexed by their first day, seasons
        by `(year, season)` with the season's key as the page names it (`DJF`, `MAM`, ...), and
        years by the year. A season that reaches back over the new year carries the year of its
        later months, as it does on the page.

        For every variable in the build, with its canonical key as the prefix:

        ============== ================================================================
        ``TA``         the span's value, a mean or a total as the variable aggregates
        ``TA_anom``    departure from the normal of the span's peer group
        ``TA_z``       that departure in standard deviations of the peer group
        ``TA_pctn``    the value as a percentage of the normal, where the normal is
                       positive; missing otherwise
        ``TA_rank``    place among the peer group, 1 being the end the variable ranks
                       from first (the highest value, or for NEE the largest uptake)
        ``TA_rank_n``  the number of spans in the peer group the rank is counted among
        ``TA_meas``    percentage of the span measured rather than gap-filled
        ``TA_avail``   percentage of the span carrying a value at all
        ``TA_unc``     the uncertainty of the value, present only for a variable whose
                       input publishes one
        ============== ================================================================

        The peer group is the same calendar month of other years, the same season of other years,
        or every year of the record, according to the scale. A final `badges` column holds the
        keys of the badges the span earned, in the order the page shows them.

        The figures are read from the payload the page is built from, with the page's own
        rounding, so the table and the page cannot disagree. A figure the page does not state is
        missing here rather than zero.
        """
        if scale not in _SCALES:
            raise ValueError(f"scale={scale!r}: expected one of {', '.join(map(repr, _SCALES))}")
        rows = self.payload[_SCALES[scale]]
        uncertain = {v["key"] for v in self.payload["variables"] if v["unc_columns"]}

        columns = {}
        for var in self.payload["variables"]:
            key = var["key"]
            for field, suffix in _TABLE_FIELDS:
                if field == "u" and key not in uncertain:
                    continue
                values = [row[key][field] for row in rows]
                # A rank is a count and stays an integer, with a missing one missing rather than a
                # float NaN that would print every placing as `3.0`.
                columns[key + suffix] = (pd.array(values, dtype="Int64") if field in ("r", "n")
                                         else pd.array(values, dtype=float))
        columns["badges"] = [tuple(b["k"] for b in row["b"]) for row in rows]

        if scale == "month":
            index = pd.DatetimeIndex([pd.Timestamp(row["y"], row["m"], 1) for row in rows],
                                     name="month")
        elif scale == "season":
            # From arrays rather than tuples, so a build without seasons gives an empty table
            # with the same two levels instead of failing to infer them.
            index = pd.MultiIndex.from_arrays(
                [pd.Index([row["y"] for row in rows], dtype="int64"),
                 pd.Index([row["s"] for row in rows], dtype=object)], names=["year", "season"])
        else:
            index = pd.Index([row["y"] for row in rows], dtype="int64", name="year")
        return pd.DataFrame(columns, index=index)

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
