"""The year scale: the spans, the badges only a year can earn, and what the page says stood out.

A year is built by the same machinery as a month and a season, so most of what could go wrong here
is shared and tested elsewhere. What is specific to this scale is the peer group - a year is judged
against every other year rather than against a slot of the calendar - and the statistics that exist
only once a year is whole: the sign of the carbon balance, the length of the growing season, and
how many of the year's own months departed from their normals.
"""

from __future__ import annotations

import pytest

import fluxatlas as fa
from fluxatlas import build


# -- The spans -----------------------------------------------------------------------------------

def test_one_span_per_year_of_the_record(full_atlas):
    payload = full_atlas.payload
    years = payload["years"]
    assert len(years) == full_atlas.last_year - full_atlas.first_year + 1
    assert [row["y"] for row in years] == list(range(full_atlas.first_year,
                                                     full_atlas.last_year + 1))
    assert payload["meta"]["n_years"] == len(years)


def test_a_year_covers_its_whole_span_of_days(full_atlas):
    """Every year addresses a real window of the daily arrays, and they tile the record."""
    rows = full_atlas.payload["years"]
    n_days = full_atlas.payload["meta"]["n_days"]
    assert rows[0]["i0"] == 0
    for row in rows:
        assert row["n"] in (365, 366)
        assert row["i0"] + row["n"] <= n_days
    assert sum(row["n"] for row in rows) == n_days


def test_a_year_is_judged_against_the_other_years(full_atlas):
    """One group, not twelve: the normal behind a year is the record and the rank is among years."""
    rows = full_atlas.payload["years"]
    n_years = len(rows)
    ranks = sorted(row["TA"]["r"] for row in rows if row["TA"]["r"] is not None)
    assert ranks == list(range(1, len(ranks) + 1))
    for row in rows:
        if row["TA"]["n"] is not None:
            assert row["TA"]["n"] <= n_years


def test_the_annual_figure_is_taken_from_the_records_and_not_from_the_months(full_atlas):
    """A mean of twelve monthly means weights February like July, and the year tile does not."""
    payload = full_atlas.payload
    for row in payload["years"][1:-1]:
        months = [m["TA"]["v"] for m in payload["months"] if m["y"] == row["y"]]
        assert None not in months
        by_month = sum(months) / len(months)
        assert row["TA"]["v"] == pytest.approx(by_month, abs=0.2)
        # Close, but the two are not the same series, which is why the year scale fits its own
        # slope rather than inheriting the one taken through the monthly aggregate.
    slopes = {m["key"]: m for m in payload["metrics"]}
    ta = slopes["TA"]
    assert set(ta["year_trend"]) == {payload["meta"]["year_slug"]}


def test_a_year_carries_its_own_colour_domain(full_atlas):
    """A total over a year is twelve times a total over a month, and shares no ramp with it."""
    prec = next(m for m in full_atlas.payload["metrics"] if m["key"] == "PREC")
    assert prec["year_domain"][1] > prec["domain"][1]


# -- Badges --------------------------------------------------------------------------------------

def test_the_scale_a_badge_is_judged_at_is_stated_once(full_atlas):
    """`badge_at_scale` is the one place that decides, and the payload carries its answer."""
    assert build.badge_at_scale(dict(key="warm"), "year") is True
    assert build.badge_at_scale(dict(key="frost"), "year") is False      # a count of days
    assert build.badge_at_scale(dict(key="gs_start"), "year") is False   # every year holds one
    assert build.badge_at_scale(dict(key="net_sink", only=("year",)), "year") is True
    assert build.badge_at_scale(dict(key="net_sink", only=("year",)), "month") is False
    for badge in full_atlas.payload["badges"]:
        assert badge["scales"], f"{badge['key']} is judged at no scale at all"


def test_a_year_only_badge_never_lands_on_a_month_or_a_season(full_atlas):
    year_only = {b["key"] for b in build.BADGES if b.get("only") == ("year",)}
    assert year_only
    for row in full_atlas.payload["months"] + full_atlas.payload["seasons"]:
        assert not year_only & {b["k"] for b in row["b"]}


def test_a_day_count_badge_never_lands_on_a_year(full_atlas):
    """Five frost days is a remarkable January and an unremarkable year."""
    for row in full_atlas.payload["years"]:
        assert not {"frost", "heat", "ice", "record_days"} & {b["k"] for b in row["b"]}


def test_the_carbon_balance_of_a_year_is_stated_by_its_sign(flux_atlas):
    """The one statement no month can make: over a summer month every site is a sink."""
    rows = flux_atlas.payload["years"]
    for row in rows:
        keys = {b["k"] for b in row["b"]}
        if row["NEE"]["v"] is None:
            continue
        assert not {"net_sink", "net_source"} <= keys, "a year cannot be both"
        if row["NEE"]["v"] < 0:
            assert "net_sink" in keys
        elif row["NEE"]["v"] > 0:
            assert "net_source" in keys
    text = [b["t"] for row in rows for b in row["b"] if b["k"] in ("net_sink", "net_source")]
    assert text and all("over the year" in t for t in text)


def test_the_badge_legend_counts_each_scale_separately(full_atlas):
    """A year-only badge would otherwise report zero of a thing it cannot be."""
    for badge in full_atlas.payload["badges"]:
        for field, rows in (("n", "months"), ("n_season", "seasons"), ("n_year", "years")):
            earned = sum(1 for row in full_atlas.payload[rows]
                         for b in row["b"] if b["k"] == badge["key"])
            assert badge[field] == earned
    swings = next(b for b in full_atlas.payload["badges"] if b["key"] == "swings")
    assert swings["n"] == 0 and swings["scales"] == ["year"]


def test_a_year_of_extremes_is_rarer_than_an_ordinary_year(full_atlas):
    """A threshold that marks most of the record marks nothing, so this one is checked for rate."""
    rows = full_atlas.payload["years"]
    marked = sum(1 for row in rows if any(b["k"] == "swings" for b in row["b"]))
    assert marked < len(rows) / 2


# -- What stood out ------------------------------------------------------------------------------

def test_every_year_carries_a_ranked_account_of_itself(full_atlas):
    for row in full_atlas.payload["years"]:
        assert isinstance(row["stood"], list)
        for item in row["stood"]:
            assert set(item) == {"k", "v", "tone"}
            assert item["v"].strip()


def test_the_account_places_the_year_among_the_others(full_atlas):
    """A placing is the half of the story a threshold cannot tell."""
    lines = [item["v"] for row in full_atlas.payload["years"] for item in row["stood"]]
    assert any("of 12 years" in line for line in lines)
    warmest = max(full_atlas.payload["years"], key=lambda row: row["TA"]["v"])
    assert any("1st of 12 years" in item["v"] for item in warmest["stood"])


def test_the_carbon_balance_leads_the_account_whatever_it_placed(flux_atlas):
    for row in flux_atlas.payload["years"]:
        if row["NEE"]["v"] is None:
            continue
        assert row["stood"][0]["k"] == "Carbon balance"
        assert "net sink" in row["stood"][0]["v"] or "net source" in row["stood"][0]["v"]


def test_a_placing_is_counted_from_the_end_that_makes_it_notable():
    assert build.place_among(9, [7, 8, 9, 10]) == (2, 4)
    assert build.place_among(9, [7, 8, 9, 10], first="low") == (3, 4)
    assert build.place_among(None, [1, 2]) == (None, 0)
    assert build.place_among(1, []) == (None, 0)
    # Ties take the same placing rather than being split by their order in the record.
    assert build.place_among(5, [5, 5, 1]) == (1, 3)


def test_the_ordinal_is_written_the_way_it_is_read():
    assert [build.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22)] == \
        ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]


# -- The renderer --------------------------------------------------------------------------------

def test_the_page_can_address_a_year(full_atlas, tmp_path):
    """The scale is only reachable if the router recognises the slug the payload ships."""
    js = (build.ASSETS / "calendar.js").read_text(encoding="utf-8")
    assert "M.year_slug" in js
    assert "year: {" in js, "the renderer has no year entry in its scale registry"
    # The season key is two to six letters, so a router matching three would refuse `DJFMAM`.
    assert "[A-Za-z]{2,6}" in js

    out = full_atlas.write(tmp_path / "atlas.html", quiet=True)
    html = out.read_text(encoding="utf-8")
    assert '<option value="year">' in html
    assert '"years":' in html or '"years": ' in html
