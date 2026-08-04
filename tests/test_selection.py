"""The behaviour the library exists for: the selection decides the whole atlas.

Every test here is a statement about what a build does *not* contain when a variable is left out.
The one-variable case is the one that used to break, so it is the one most heavily asserted.
"""

from __future__ import annotations

import pytest

from fluxatlas import build


def test_one_variable_produces_only_that_variable_s_metrics(ta_atlas):
    assert ta_atlas.variables == ["TA"]
    for metric in ta_atlas.payload["metrics"]:
        assert metric["var"] == "TA", f"{metric['key']} reads {metric['var']} in a TA-only build"


def test_more_variables_produce_more_metrics(ta_atlas, full_atlas):
    assert len(full_atlas.metrics) > len(ta_atlas.metrics)
    assert {m["var"] for m in full_atlas.payload["metrics"]} == {"TA", "PREC", "SW_IN"}


def test_a_metric_is_never_offered_without_values(ta_atlas, full_atlas):
    """A metric in the picker that colours every tile grey is worse than an absent one."""
    for atlas in (ta_atlas, full_atlas):
        for metric in atlas.payload["metrics"]:
            values = [build.row_value(metric, row) for row in atlas.payload["months"]]
            assert any(v is not None for v in values), f"{metric['key']} has no values at all"


def test_the_composite_is_withheld_below_its_minimum_axes(ta_atlas, full_atlas):
    """A count out of two axes is not comparable with a count out of five, so it is not shown."""
    assert build.COMPOSITE_MIN_AXES > 3
    assert not [m for m in ta_atlas.payload["metrics"] if m["key"] in ("zmax", "nsd")]
    assert not [m for m in full_atlas.payload["metrics"] if m["key"] in ("zmax", "nsd")]
    assert ta_atlas.payload["meta"]["composite_vars"] == ["TA"]


def test_badges_needing_an_absent_variable_are_withheld_with_a_reason(ta_atlas):
    months = ta_atlas.payload["months"]
    reasons = {s["why"] for row in months for s in row["sup"]}
    assert any("not included in this build" in why for why in reasons)
    # And no month may claim a badge that reads a variable the build does not have.
    prec_badges = {b["key"] for b in build.BADGES if "PREC" in b["needs"]}
    earned = {b["k"] for row in months for b in row["b"]}
    assert not (earned & prec_badges)


def test_day_tests_of_absent_variables_are_dropped(ta_atlas, full_atlas):
    ta_flags = {f["key"] for f in ta_atlas.payload["flags"]}
    full_flags = {f["key"] for f in full_atlas.payload["flags"]}
    assert {"frost", "hot"} <= ta_flags          # TA's own tests survive
    assert "wet" not in ta_flags                 # PREC's do not
    assert "wet" in full_flags
    assert all(f["var"] == "TA" for f in ta_atlas.payload["flags"])


def test_flag_bits_are_contiguous_after_tests_are_dropped(ta_atlas):
    """A dropped test must not leave a hole in the bit word the page reads."""
    bits = [f["bit"] for f in ta_atlas.payload["flags"]]
    assert bits == list(range(len(bits)))
    assert len(bits) <= 30                        # one 30-bit word, read bitwise in JavaScript


def test_the_coverage_badge_reports_on_the_selection(ta_atlas, full_atlas):
    """It used to name TA and PREC whatever the build contained, and crash without PREC."""
    for atlas, allowed in ((ta_atlas, {"TA"}), (full_atlas, {"TA", "PREC", "SW_IN"})):
        texts = [b["t"] for row in atlas.payload["months"] for b in row["b"] if b["k"] == "sparse"]
        for text in texts:
            named = {key for key in ("TA", "PREC", "SW_IN", "VPD", "RH", "SWC") if key in text}
            assert named <= allowed, f"sparse badge names {named - allowed}"


def test_a_badge_may_ask_about_a_day_test_that_is_not_in_the_build():
    """Zero, not KeyError: the build cannot have observed what it never tested for."""
    stats = build.SpanStats(y=2020)
    assert stats["n_recwet"] == 0
    assert stats["spell_dry"] == 0
    with pytest.raises(KeyError):
        stats["TA_meas"]                          # a real statistic that was never computed


def test_selecting_a_variable_absent_from_the_file_is_an_error(parquet_path):
    import fluxatlas as fa
    with pytest.raises(KeyError, match="carries no column for VPD"):
        fa.Atlas(parquet_path, ["VPD"], quiet=True)
