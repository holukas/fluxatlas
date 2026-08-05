"""The season scheme: what the caller may define, what follows from it, and what the page says.

Only the first season is stated and the rest are derived, so the tests that matter are the ones
about the derivation: that it covers the year exactly once, that a season crossing the new year is
labelled by the right one, and that a scheme nobody can read is refused rather than half-built.
"""

from __future__ import annotations

import pytest

import fluxatlas as fa
from fluxatlas import build


# -- Reading the definition ----------------------------------------------------------------------

def test_month_initials_are_read_as_a_run_of_months():
    """Three initials name two months each, so they cannot be read letter by letter."""
    assert build.parse_season_spec("DJF") == (12, 1, 2)
    assert build.parse_season_spec("JJA") == (6, 7, 8)
    assert build.parse_season_spec("MAM") == (3, 4, 5)
    assert build.parse_season_spec("SON") == (9, 10, 11)
    # `J` alone is January, being the first month whose initial matches.
    assert build.parse_season_spec("J") == (1,)


def test_month_numbers_are_accepted_too():
    assert build.parse_season_spec("12,1,2") == (12, 1, 2)
    assert build.parse_season_spec("6 7 8") == (6, 7, 8)


def test_a_record_without_seasons_says_so():
    for spec in ("none", "None", "off", "", None):
        assert build.parse_season_spec(spec) is None
        assert build.season_scheme(spec) == []


def test_an_unreadable_definition_is_refused_with_the_reason(recwarn):
    with pytest.raises(ValueError, match="no run of consecutive months"):
        build.season_scheme("DFJ")
    with pytest.raises(ValueError, match="does not divide the year"):
        build.season_scheme("MJJAS")          # five months
    with pytest.raises(ValueError, match="not a month number"):
        build.season_scheme("13,1")


# -- Deriving the rest ---------------------------------------------------------------------------

def test_the_scheme_covers_the_year_exactly_once():
    for spec in ("DJF", "MAM", "DJFMAM", "DJFM", "JF", "J", "JJA"):
        scheme = build.season_scheme(spec)
        covered = [m for s in scheme for m in s["months"]]
        assert sorted(covered) == list(range(1, 13)), f"{spec} does not tile the year"


def test_the_usual_four_keep_their_names_and_anything_else_is_named_by_its_months():
    four = {s["key"]: s["label"] for s in build.season_scheme("DJF")}
    assert four == {"DJF": "Winter", "MAM": "Spring", "JJA": "Summer", "SON": "Autumn"}
    # Starting elsewhere still recognises them; only the order changes.
    assert {s["label"] for s in build.season_scheme("JJA")} == set(four.values())
    half = build.season_scheme("DJFMAM")
    assert [s["key"] for s in half] == ["DJFMAM", "JJASON"]
    assert half[0]["label"] == "DJFMAM", "a season this page invented is named by its months"


def test_a_one_month_scheme_is_named_by_the_month():
    """Initials repeat one month at a time - March and May are both `M` - and the key is an id."""
    scheme = build.season_scheme("J")
    keys = [s["key"] for s in scheme]
    assert len(set(keys)) == 12
    assert keys[0] == "Jan" and scheme[0]["label"] == "January"


def test_a_season_crossing_the_new_year_is_labelled_by_its_later_months():
    winter = build.season_scheme("DJF")[0]
    # December belongs to the winter of the following year; January and February to their own.
    assert winter["shift"] == {12: 1, 1: 0, 2: 0}
    summer = build.season_scheme("DJF")[2]
    assert set(summer["shift"].values()) == {0}, "a season inside one year shifts nothing"


def test_the_spans_run_from_the_first_month_to_the_last():
    spans = build.season_periods(2010, 2011, build.season_scheme("DJF"))
    winter = next(sp for sp in spans if sp["y"] == 2011 and sp["skey"] == "DJF")
    assert (winter["start"].year, winter["start"].month) == (2010, 12)
    assert (winter["end"].year, winter["end"].month) == (2011, 2)
    assert winter["n_days"] == 31 + 31 + 28


# -- What the page is built with -----------------------------------------------------------------

def test_a_built_atlas_carries_the_scheme_it_was_given(flux_parquet_path):
    atlas = fa.Atlas(flux_parquet_path, ["TA"], site="XX-Syn", hourly=False, quiet=True,
                     seasons="DJFMAM")
    payload = atlas.payload
    n_years = atlas.last_year - atlas.first_year + 1
    assert [d["key"] for d in payload["season_defs"]] == ["DJFMAM", "JJASON"]
    assert len(payload["seasons"]) == 2 * n_years
    # And the page states it, because a tile labelled JJASON is half a year, not a quarter of one.
    note = payload["meta"]["season_note"]
    assert "6 months" in note and "not the usual four-season" in note


def test_the_default_scheme_needs_no_explaining(flux_parquet_path):
    atlas = fa.Atlas(flux_parquet_path, ["TA"], site="XX-Syn", hourly=False, quiet=True)
    assert atlas.payload["meta"]["season_note"] == \
        "The four meteorological seasons: DJF, MAM, JJA, SON."


def test_a_build_without_seasons_offers_no_season_scale(flux_parquet_path):
    atlas = fa.Atlas(flux_parquet_path, ["TA", "NEE"], site="XX-Syn", hourly=False, quiet=True,
                     seasons="none")
    payload = atlas.payload
    assert payload["season_defs"] == []
    assert payload["seasons"] == []
    assert payload["season_climatology"] == {}
    assert payload["meta"]["season_note"] is None
    # The month scale is untouched by it.
    assert len(payload["months"]) == 12 * (atlas.last_year - atlas.first_year + 1)


def test_the_seasonal_figures_are_the_months_they_are_made_of(flux_parquet_path):
    """A season is an aggregate of its own months and of no others."""
    atlas = fa.Atlas(flux_parquet_path, ["PREC"], site="XX-Syn", hourly=False, quiet=True,
                     seasons="DJF")
    months = {(mo["y"], mo["m"]): mo["PREC"]["v"] for mo in atlas.payload["months"]}
    digits = next(v["digits"] for v in atlas.payload["variables"] if v["key"] == "PREC")
    # Both sides are rounded for display, so three months rounded to a tenth cannot sum to a
    # season rounded to a tenth. The tolerance is that rounding and nothing more.
    tolerance = (len(atlas.payload["season_defs"][0]["months"]) + 1) * 10 ** -digits
    for season in atlas.payload["seasons"]:
        parts = [months.get((y, m)) for y, m in season["months"]]
        if any(p is None for p in parts) or season["PREC"]["v"] is None:
            continue                       # a season the record only partly reaches
        assert season["PREC"]["v"] == pytest.approx(sum(parts), abs=tolerance)
