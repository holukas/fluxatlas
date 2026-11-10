"""The figures of the variable page as pandas DataFrames, read from the payload the page is built from.

`Atlas.table` gives the span tiles. What the variable page shows beyond them lives in four other
parts of the payload, and each has a reader here:

=================== ======================================================= =========================
``year_record``     each year's half-hourly percentiles, measured extremes, ``payload["var_record"]``
                    new records and longest gap
``correction``      what a correction did, read back from the uncorrected   ``variables[i]["correction"]``
                    twin: per year, per era of the source flag, in summary
``reference``       the residual against a reference station: per month,    ``payload["reference"]``
                    per year, and across a hardware change
``sources``         each year's share of records under each code of the     ``variables[i]["source"]``
                    source flag
=================== ======================================================= =========================

Every function takes the payload and a variable key. The figures are the payload's own, with the
page's rounding, so a table and the page cannot disagree. A figure the page does not state is
missing rather than zero, and a count is an `Int64` column so that a missing one stays missing.

A variable the build does not carry, or a setting the build did not name for it, raises a
`KeyError` that says which, rather than returning an empty frame. A reference comparison the build
withheld raises `Withheld`, carrying the reason the page states.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

__all__ = ["Withheld", "Correction", "Reference", "year_record", "correction", "reference",
           "sources"]

# The percentiles `record.var_record_layer` ships, as the column names it ships them under.
_QUANTILES = ("q05", "q25", "q50", "q75", "q95")


class Withheld(ValueError):
    """A figure the build computed no value for, and said why.

    `key` is the variable and `reason` the sentence the page prints in its place.
    """

    def __init__(self, key, what, reason):
        self.key = key
        self.reason = reason
        super().__init__(f"{key}: the {what} is withheld: {reason}")


@dataclass(frozen=True)
class Correction:
    """What a correction did to one variable, as the variable page states it.

    `yearly` and `eras` are DataFrames; `eras` is None where the build names no source flag for the
    variable, since the eras are the flag's codes. `summary` holds the figures over the whole
    record. See `correction` for the columns and the keys.
    """

    yearly: pd.DataFrame
    eras: pd.DataFrame | None
    summary: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Reference:
    """The residual of one variable against the reference station, as the variable page states it.

    `monthly` and `yearly` are DataFrames; `steps` is None where the build names no hardware change
    for the variable. `summary` holds the figures over the whole overlap. See `reference` for the
    columns and the keys.
    """

    monthly: pd.DataFrame
    yearly: pd.DataFrame
    steps: pd.DataFrame | None
    summary: dict = field(default_factory=dict)


# ----------------------------------------------------------------------------------------------
# Looking things up
# ----------------------------------------------------------------------------------------------

def _keys(payload):
    return [v["key"] for v in payload["variables"]]


def _entry(payload, key):
    """The variable's entry in `payload["variables"]`, or a KeyError naming what the build carries."""
    for v in payload["variables"]:
        if v["key"] == key:
            return v
    raise KeyError(f"{key!r} is not in this build; it carries {', '.join(_keys(payload))}")


def _years(payload):
    meta = payload["meta"]
    return pd.Index(range(meta["first_year"], meta["last_year"] + 1), dtype="int64", name="year")


def _floats(values):
    return pd.array(values, dtype=float)


def _frame(rows, index, fields):
    """A DataFrame of `rows`, a list of dicts, one column per `(name, kind)` in `fields`, in order.

    The kind is `float`, `"Int64"` for a count, or `object` for text.
    """
    return pd.DataFrame({name: pd.array([row.get(name) for row in rows], dtype=kind)
                         for name, kind in fields}, index=index)


# ----------------------------------------------------------------------------------------------
# The year-by-year record
# ----------------------------------------------------------------------------------------------

def year_record(payload, key):
    """Each year's spread, measured extremes, new records and longest gap, one row per year.

    Indexed by `year`, every year of the build whether or not it carries a value. The columns:

    ================== ============================================================================
    ``q05`` … ``q95``  the 5th, 25th, 50th, 75th and 95th percentile of the year's half-hours, on
                       the basis `attrs["basis"]` states
    ``measured_min``   the lowest and the highest half-hour of the year that was measured; a
    ``measured_max``   gap-filled value is a model result and sets no extreme
    ``new_highs``      days of the year whose measured maximum passed every day before it; missing
                       up to and including the first year with a measured day
    ``new_lows``       the same for the measured minimum; missing in every year for a variable
                       the page states no low half-hours for, such as precipitation
    ``longest_gap_h``  the longest run of half-hours not measured, in hours, counted in the year
                       it starts in
    ================== ============================================================================

    `attrs` carries what holds for the record as a whole:

    ================== ============================================================================
    ``units``          the units of every figure in the table. A carbon flux is stated as the rate
                       the file published, in µmol m⁻² s⁻¹, not as the g C m⁻² of its spans
    ``rate``           True where that conversion back to a rate applies
    ``basis``          ``"half-hourly values"``, or ``"half-hours above zero"`` for a total whose
                       zero is a floor (precipitation, gross uptake)
    ``measured``       the share of the record measured, in percent
    ``inside``         whether the gap-filled series stays inside the measured range: a dict with
                       ``ok``, the range of every value (``min``, ``max``), the measured range
                       (``measured_min``, ``measured_max``) and how many half-hours fall above and
                       below it (``n_above``, ``n_below``); None where nothing was measured
    ``month_min``      the lowest and the highest measured half-hour of each calendar month over
    ``month_max``      the record, as dicts from the month, 1 to 12, to the value; None where
                       a calendar month has no measured half-hour
    ================== ============================================================================
    """
    _entry(payload, key)
    found = (payload.get("var_record") or {}).get("vars", {})
    if key not in found:
        raise KeyError(f"{key!r} has no year-by-year record in this payload")
    rec = found[key]
    years = _years(payload)
    n = len(years)

    def column(name, dtype):
        values = rec.get(name)
        return pd.array([None] * n if values is None else values, dtype=dtype)

    columns = {q: column(q, float) for q in _QUANTILES}
    columns.update(measured_min=column("mmin", float), measured_max=column("mmax", float),
                   new_highs=column("rec_high", "Int64"), new_lows=column("rec_low", "Int64"),
                   longest_gap_h=column("gap_h", float))
    out = pd.DataFrame(columns, index=years)

    inside = rec.get("inside")
    out.attrs.update(
        units=rec["units"], rate=bool(rec.get("rate")), basis=rec["basis"],
        measured=rec.get("meas"),
        inside=None if inside is None else dict(
            ok=inside["ok"], min=inside["lo"], max=inside["hi"], measured_min=inside["mlo"],
            measured_max=inside["mhi"], n_above=inside["n_over"], n_below=inside["n_under"]),
        month_min=dict(zip(range(1, 13), rec["clim_lo"])),
        month_max=dict(zip(range(1, 13), rec["clim_hi"])),
    )
    return out


# ----------------------------------------------------------------------------------------------
# A correction
# ----------------------------------------------------------------------------------------------

_SUMMARY = ("n", "n_changed", "min", "max", "mean", "distinct")


def correction(payload, key):
    """What a correction did, as the corrected series minus its uncorrected twin.

    Only a variable the build named an uncorrected twin for (`raw`) carries one. The difference is
    read back out of the file, half-hour by half-hour, wherever both columns carry a value.

    `Correction.yearly`, indexed by `year` over the years the difference exists in:

    ========== =================================================================================
    ``mean``   the mean, lowest and highest difference over the year's half-hours
    ``min``
    ``max``
    ``n``      the half-hours both columns carry
    ========== =================================================================================

    `Correction.eras`, indexed by the source flag's `code`, present only where the build names a
    source flag for the variable:

    ============== =============================================================================
    ``label``      the code's long label, from the legend, or ``code N`` without one
    ``offset``     the difference where it is one constant through the era; missing otherwise
    ``n``          the half-hours of the era both columns carry, and how many of them differ
    ``n_changed``
    ``min``        the lowest, highest and mean difference in the era
    ``max``
    ``mean``
    ``distinct``   the number of distinct differences, 1 for a constant offset
    ============== =============================================================================

    `Correction.summary` holds `column` (the twin), `n`, `n_changed`, `min`, `max`, `mean` and
    `distinct` over the whole record, and where the build names a reference code for the source
    flag, `reference_code` and `reference_from` (the first day of that era), `offset` (the constant
    before it, missing where it was not one) and `reference_min` (the lowest difference in it).
    `note` is the site's correction note with its figures filled in. A key the build has no figure
    for is None.
    """
    v = _entry(payload, key)
    c = v.get("correction")
    if c is None:
        raise KeyError(f"{key!r} carries no correction: the build names no uncorrected twin "
                       f"(`raw`) for it")
    yearly = c.get("yearly", [])
    by_year = _frame(yearly, pd.Index([row["y"] for row in yearly], dtype="int64", name="year"),
                     [("mean", float), ("min", float), ("max", float), ("n", "Int64")])

    eras = None
    if "eras" in c:
        rows = c["eras"]
        eras = _frame(rows, pd.Index([row["code"] for row in rows], dtype="int64", name="code"),
                      [("label", object), ("offset", float), ("n", "Int64"),
                       ("n_changed", "Int64"), ("min", float), ("max", float), ("mean", float),
                       ("distinct", "Int64")])

    summary = dict(column=c["column"], **{k: c.get(k) for k in _SUMMARY})
    for name in ("reference_code", "reference_from", "offset", "reference_min", "note"):
        summary[name] = c.get(name)
    return Correction(yearly=by_year, eras=eras, summary=summary)


# ----------------------------------------------------------------------------------------------
# A reference station
# ----------------------------------------------------------------------------------------------

def reference(payload, key):
    """The residual of the product minus the reference station, over their measured overlap.

    Only measured half-hours of the product take part. Where the build splits the comparison by
    the sun (`split`), the residual is stated for night and for day; otherwise for all hours. The
    window keys are ``all``, ``night`` and ``day``.

    `Reference.monthly`, indexed by `month` (its first day) from the first month of the overlap to
    the last:

    ==================== =======================================================================
    ``<window>``         the mean residual of the month in that window
    ``<window>_median``  the centred 12-month rolling median through it, the line the page draws
    ==================== =======================================================================

    `Reference.yearly`, indexed by `year` over the years of the overlap: `n` (the half-hours
    compared), `mean` and `sd` of the residual over all hours, and where the comparison is split,
    `night` and `day`, the mean residual in each.

    `Reference.steps`, indexed by `window`, present only where the build names a source flag with
    a reference code: the mean residual over the `step_years` complete years `before` the year of
    the change and `after` it, the year itself left out, the `step` between them, and the
    half-hours each mean rests on (`n_before`, `n_after`).

    `Reference.summary` holds the `station`, its `file`, `distance_km` and `elevation_m` where
    given, the reference `column`, `split`, the `shift` in minutes, the overlap (`n`, `start`,
    `stop`), the correlation `r`, the `mean` and `sd` of the residual, `min_overlap`, and where
    there are steps, `break_year` and `step_years`. A key the build has no figure for is None.

    Raises `Withheld`, with the page's reason, where the overlap was too short to compare.
    """
    _entry(payload, key)
    ref = payload.get("reference")
    if not ref or key not in ref.get("vars", {}):
        raise KeyError(f"{key!r} is not compared with a reference station: the build names no "
                       f"reference column for it")
    found = ref["vars"][key]
    if "withheld" in found:
        raise Withheld(key, "reference comparison", found["withheld"])

    months = pd.DatetimeIndex(pd.to_datetime(found["months"], format="%Y-%m"), name="month")
    columns = {}
    for s in found["series"]:
        columns[s["key"]] = _floats(s["values"])
        columns[s["key"] + "_median"] = _floats(s["smooth"])
    monthly = pd.DataFrame(columns, index=months)

    windows = [s["key"] for s in found["series"] if s["key"] != "all"]
    rows = found["yearly"]
    yearly = _frame(rows, pd.Index([row["y"] for row in rows], dtype="int64", name="year"),
                    [("n", "Int64"), ("mean", float), ("sd", float)]
                    + [(w, float) for w in windows])

    steps = None
    if "steps" in found:
        rows = found["steps"]
        steps = _frame(rows, pd.Index([row["key"] for row in rows], dtype=object, name="window"),
                       [("before", float), ("after", float), ("step", float),
                        ("n_before", "Int64"), ("n_after", "Int64")])

    summary = {k: ref.get(k) for k in ("station", "file", "distance_km", "elevation_m")}
    summary.update({k: found.get(k) for k in ("column", "split", "shift", "n", "start", "stop",
                                              "r", "mean", "sd")})
    summary["min_overlap"] = ref.get("min_overlap")
    summary.update(break_year=found.get("break_year"), step_years=found.get("step_years"))
    return Reference(monthly=monthly, yearly=yearly, steps=steps, summary=summary)


# ----------------------------------------------------------------------------------------------
# The source flag
# ----------------------------------------------------------------------------------------------

def sources(payload, key):
    """Each year's share of the records carrying the source flag under each of its codes.

    Indexed by `year`, every year of the build. The columns are a MultiIndex of `code` and
    `label`, the code's long label: with a legend, every code of the legend in its order, whether
    or not the record carries it; without one, the codes the record carries, labelled ``code N``.
    Each share is in percent of the year's records that carry the flag, so a year's shares add up
    to a hundred whatever part of it the flag reaches; a year with no flagged record is missing
    throughout.

    `attrs` holds the flag's `column`, its `short` labels in the order of the columns, `given`
    (whether the build supplied the legend), and where the build names a reference code,
    `reference_code` and `reference_from`, the first day carrying it. A key the build has no figure
    for is None.
    """
    v = _entry(payload, key)
    src = v.get("source")
    if src is None:
        raise KeyError(f"{key!r} carries no source flag: the build names none (`source`) for it")
    years = _years(payload)
    width = len(src["codes"])
    rows = [[None] * width if row is None else row for row in src["shares"]]
    columns = pd.MultiIndex.from_arrays(
        [pd.Index(src["codes"], dtype="int64"), pd.Index(src["long"], dtype=object)],
        names=["code", "label"])
    out = pd.DataFrame({col: _floats([row[i] for row in rows]) for i, col in enumerate(columns)},
                       index=years)
    out.columns = columns
    out.attrs.update(column=src["column"], short=list(src["short"]), given=bool(src["given"]),
                     reference_code=src.get("reference_code"),
                     reference_from=src.get("reference_from"))
    return out
