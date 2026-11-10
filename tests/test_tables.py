"""The variable page's figures as DataFrames: `fluxatlas.tables`.

Each table is read from the payload the page is built from, so every test here asserts the same two
things: that a column states exactly the payload's figures, with nothing rounded again or filled in,
and that what the build does not carry is an error naming it rather than an empty frame. The data
are the site settings of `test_site_settings.py`, which build every setting at once.
"""

from __future__ import annotations

import copy

import pandas as pd
import pytest

import fluxatlas as fa
from fluxatlas import tables
from test_site_settings import (entry, reference_path, site_atlas, site_frame,  # noqa: F401
                                site_path)


def same(column, payload_values):
    """A column equals the payload's list, missing where the payload is null."""
    found = [None if pd.isna(x) else x for x in column.tolist()]
    assert found == list(payload_values)


# -- The year-by-year record ----------------------------------------------------------------------

def test_the_year_record_states_the_payloads_figures(site_atlas):
    p = site_atlas.payload
    rec = p["var_record"]["vars"]["TA"]
    t = tables.year_record(p, "TA")
    assert list(t.index) == list(range(p["meta"]["first_year"], p["meta"]["last_year"] + 1))
    assert t.index.name == "year"
    assert list(t.columns) == ["q05", "q25", "q50", "q75", "q95", "measured_min", "measured_max",
                               "new_highs", "new_lows", "longest_gap_h"]
    for column, field in [("q05", "q05"), ("q50", "q50"), ("q95", "q95"),
                          ("measured_min", "mmin"), ("measured_max", "mmax"),
                          ("new_highs", "rec_high"), ("new_lows", "rec_low"),
                          ("longest_gap_h", "gap_h")]:
        same(t[column], rec[field])
    assert str(t["new_highs"].dtype) == "Int64" and str(t["new_lows"].dtype) == "Int64"
    assert t["q50"].dtype == float
    # The first year with a measured day sets no record count: missing, not zero.
    assert pd.isna(t["new_highs"].iloc[0])


def test_the_year_record_carries_what_holds_for_the_whole_record(site_atlas):
    p = site_atlas.payload
    rec = p["var_record"]["vars"]["TA"]
    attrs = tables.year_record(p, "TA").attrs
    assert attrs["units"] == "°C" and attrs["rate"] is False
    assert attrs["basis"] == "half-hourly values"
    assert attrs["measured"] == rec["meas"]
    inside = rec["inside"]
    assert attrs["inside"] == dict(ok=inside["ok"], min=inside["lo"], max=inside["hi"],
                                   measured_min=inside["mlo"], measured_max=inside["mhi"],
                                   n_above=inside["n_over"], n_below=inside["n_under"])
    assert list(attrs["month_min"]) == list(range(1, 13))
    assert list(attrs["month_max"].values()) == rec["clim_hi"]


def test_a_depth_that_begins_late_is_missing_rather_than_zero(site_atlas):
    t = tables.year_record(site_atlas.payload, "SWC@0.05")
    assert t["longest_gap_h"].iloc[0] == 365 * 24 * 3 + 24
    assert t["new_highs"].iloc[:4].isna().all()
    assert t["q50"].iloc[:3].isna().all() and t["q50"].iloc[3:].notna().all()


def test_the_year_record_follows_the_page_on_totals(flux_atlas):
    p = flux_atlas.payload
    nee = tables.year_record(p, "NEE")
    assert nee.attrs["units"] == "µmol m⁻² s⁻¹" and nee.attrs["rate"] is True
    prec = tables.year_record(p, "PREC")
    assert prec.attrs["basis"] == "half-hours above zero"
    # The page states no low half-hours of rain, so the column is missing throughout.
    assert prec["new_lows"].isna().all() and str(prec["new_lows"].dtype) == "Int64"


# -- A correction ---------------------------------------------------------------------------------

def test_the_correction_states_each_year_and_each_era(site_atlas):
    p = site_atlas.payload
    c = entry(site_atlas, "TA")["correction"]
    found = tables.correction(p, "TA")
    assert isinstance(found, tables.Correction)

    yearly = found.yearly
    assert list(yearly.index) == [row["y"] for row in c["yearly"]] and yearly.index.name == "year"
    assert list(yearly.columns) == ["mean", "min", "max", "n"]
    same(yearly["mean"], [row["mean"] for row in c["yearly"]])
    assert str(yearly["n"].dtype) == "Int64"

    eras = found.eras
    assert eras.index.name == "code" and sorted(eras.index) == [0, 1, 2]
    assert list(eras.columns) == ["label", "offset", "n", "n_changed", "min", "max", "mean",
                                  "distinct"]
    assert eras.loc[1, "label"] == "old sensor"
    assert eras.loc[1, "offset"] == pytest.approx(1.3) and eras.loc[1, "distinct"] == 1
    assert pd.isna(eras.loc[0, "offset"]) and eras.loc[0, "max"] <= 0
    assert str(eras["n_changed"].dtype) == "Int64"


def test_the_correction_summary_is_the_payloads(site_atlas):
    c = entry(site_atlas, "TA")["correction"]
    s = tables.correction(site_atlas.payload, "TA").summary
    assert s["column"] == "TA_SITE_RAW"
    for name in ("n", "n_changed", "min", "max", "mean", "distinct", "reference_code",
                 "reference_from", "offset", "reference_min", "note"):
        assert s[name] == c[name], name
    assert s["offset"] == pytest.approx(1.3) and s["reference_from"] == "2015-01-08"


def test_a_correction_without_a_source_flag_has_no_eras(site_atlas):
    p = copy.deepcopy(site_atlas.payload)
    c = entry(site_atlas, "TA")["correction"]
    stripped = {k: v for k, v in c.items()
                if k not in ("eras", "reference_code", "reference_from", "offset",
                             "reference_min")}
    next(v for v in p["variables"] if v["key"] == "TA")["correction"] = stripped
    found = tables.correction(p, "TA")
    assert found.eras is None and len(found.yearly) == len(c["yearly"])
    assert found.summary["offset"] is None and found.summary["reference_code"] is None


# -- A reference station --------------------------------------------------------------------------

def test_the_reference_residual_states_each_window(site_atlas):
    p = site_atlas.payload
    ta = p["reference"]["vars"]["TA"]
    found = tables.reference(p, "TA")
    assert isinstance(found, tables.Reference)

    monthly = found.monthly
    assert list(monthly.columns) == ["night", "night_median", "day", "day_median"]
    assert monthly.index.name == "month" and isinstance(monthly.index, pd.DatetimeIndex)
    assert [f"{m:%Y-%m}" for m in monthly.index] == ta["months"]
    night = next(s for s in ta["series"] if s["key"] == "night")
    same(monthly["night"], night["values"])
    same(monthly["night_median"], night["smooth"])

    yearly = found.yearly
    assert list(yearly.columns) == ["n", "mean", "sd", "night", "day"]
    same(yearly["day"], [row["day"] for row in ta["yearly"]])
    assert str(yearly["n"].dtype) == "Int64"
    assert yearly["mean"].mean() == pytest.approx(0.5, abs=0.02)

    steps = found.steps
    assert list(steps.index) == ["all", "night", "day"] and steps.index.name == "window"
    assert list(steps.columns) == ["before", "after", "step", "n_before", "n_after"]
    same(steps["step"], [s["step"] for s in ta["steps"]])


def test_the_reference_summary_is_the_payloads(site_atlas):
    s = tables.reference(site_atlas.payload, "TA").summary
    assert s["station"] == "Syn reference" and s["distance_km"] == 2.0
    assert s["column"] == "TA_REF" and s["split"] is True
    assert s["break_year"] == 2015 and s["step_years"] == 3
    assert s["min_overlap"] == 10_000
    assert s["mean"] == site_atlas.payload["reference"]["vars"]["TA"]["mean"]


def test_an_unsplit_comparison_states_all_hours_and_no_steps(site_atlas):
    found = tables.reference(site_atlas.payload, "PA")
    assert list(found.monthly.columns) == ["all", "all_median"]
    assert list(found.yearly.columns) == ["n", "mean", "sd"]
    assert found.steps is None and found.summary["break_year"] is None


def test_a_withheld_comparison_raises_with_the_pages_reason(site_path, reference_path):
    atlas = fa.Atlas(site_path, {"TA": dict(column="TA_SITE", qc="TA_SITE_FLAG",
                                            measured_codes=[5], reference=dict(column="TA_REF"))},
                     quiet=True, hourly=False, reference=dict(file=reference_path))
    reason = atlas.payload["reference"]["vars"]["TA"]["withheld"]
    with pytest.raises(tables.Withheld, match="fewer than the 10,000") as caught:
        tables.reference(atlas.payload, "TA")
    assert caught.value.key == "TA" and caught.value.reason == reason


# -- The source flag ------------------------------------------------------------------------------

def test_the_source_shares_are_indexed_by_code_and_label(site_atlas):
    p = site_atlas.payload
    src = entry(site_atlas, "TA")["source"]
    t = tables.sources(p, "TA")
    assert t.columns.names == ["code", "label"]
    assert list(t.columns) == [(0, "new sensor"), (1, "old sensor"), (2, "changeover")]
    assert t.index.name == "year" and len(t) == len(src["shares"])
    assert t.iloc[0].tolist() == [0.0, 100.0, 0.0]
    assert t.loc[:, 2].iloc[5, 0] > 0
    for i, column in enumerate(t.columns):
        same(t[column], [row[i] for row in src["shares"]])
    assert t.attrs == dict(column="TA_SITE_SOURCE", short=["new", "old", "change"], given=True,
                           reference_code=0, reference_from="2015-01-08")


def test_a_source_without_a_legend_is_labelled_by_its_codes(site_atlas):
    t = tables.sources(site_atlas.payload, "SWC")
    assert list(t.columns) == [(1, "code 1"), (2, "code 2")]
    assert t.attrs["given"] is False and t.attrs["reference_code"] is None


def test_a_year_with_no_flagged_record_is_missing(site_atlas):
    p = copy.deepcopy(site_atlas.payload)
    next(v for v in p["variables"] if v["key"] == "TA")["source"]["shares"][3] = None
    t = tables.sources(p, "TA")
    assert t.iloc[3].isna().all() and t.iloc[2].notna().all()


# -- What the build does not carry ----------------------------------------------------------------

@pytest.mark.parametrize("read", [tables.year_record, tables.correction, tables.reference,
                                  tables.sources])
def test_a_variable_outside_the_build_is_an_error_naming_it(site_atlas, read):
    with pytest.raises(KeyError, match=r"'NEE' is not in this build; it carries TA, "):
        read(site_atlas.payload, "NEE")


def test_a_setting_the_build_did_not_name_is_an_error_naming_it(flux_atlas):
    p = flux_atlas.payload
    with pytest.raises(KeyError, match="'TA' carries no correction.*`raw`"):
        tables.correction(p, "TA")
    with pytest.raises(KeyError, match="'TA' is not compared with a reference station"):
        tables.reference(p, "TA")
    with pytest.raises(KeyError, match="'TA' carries no source flag.*`source`"):
        tables.sources(p, "TA")


def test_a_variable_compared_elsewhere_in_the_build_is_still_an_error(site_atlas):
    # The build compares TA and PA with the station; SWC is in the build and is not compared.
    with pytest.raises(KeyError, match="'SWC' is not compared"):
        tables.reference(site_atlas.payload, "SWC")
    with pytest.raises(KeyError, match="'PA' carries no correction"):
        tables.correction(site_atlas.payload, "PA")


# -- The methods on Atlas -------------------------------------------------------------------------

def test_the_atlas_methods_are_the_tables_of_its_own_payload(site_atlas):
    p = site_atlas.payload
    pd.testing.assert_frame_equal(site_atlas.year_record("TA"), tables.year_record(p, "TA"))
    assert site_atlas.year_record("TA").attrs == tables.year_record(p, "TA").attrs
    pd.testing.assert_frame_equal(site_atlas.sources("TA"), tables.sources(p, "TA"))

    c, expected = site_atlas.correction("TA"), tables.correction(p, "TA")
    pd.testing.assert_frame_equal(c.yearly, expected.yearly)
    pd.testing.assert_frame_equal(c.eras, expected.eras)
    assert c.summary == expected.summary

    r, expected = site_atlas.reference("TA"), tables.reference(p, "TA")
    for part in ("monthly", "yearly", "steps"):
        pd.testing.assert_frame_equal(getattr(r, part), getattr(expected, part))
    assert r.summary == expected.summary


def test_the_atlas_methods_raise_what_the_functions_raise(flux_atlas):
    with pytest.raises(KeyError, match="'XX' is not in this build"):
        flux_atlas.year_record("XX")
    with pytest.raises(KeyError, match="carries no correction"):
        flux_atlas.correction("TA")
    with pytest.raises(KeyError, match="not compared with a reference station"):
        flux_atlas.reference("TA")
    with pytest.raises(KeyError, match="carries no source flag"):
        flux_atlas.sources("TA")


def test_the_package_exports_the_tables_and_withheld():
    assert fa.Withheld is tables.Withheld and fa.tables is tables
    assert {"Withheld", "tables"} <= set(fa.__all__)
    assert issubclass(fa.Withheld, ValueError)
