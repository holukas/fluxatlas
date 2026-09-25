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
from conftest import add_fluxes, synthetic_frame
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


# The two travelling sets are written out rather than derived from each other, because a future
# badge could belong to one and not the other. That makes drift possible, and drift is exactly how
# the carbon badges came to be judged at the year scale and not at the season scale for a while. So
# the relationship is pinned here: the year is the season's set less the four turning points, every
# one of which every year holds.
TURNING_POINTS = {"gs_start", "gs_end", "last_frost", "first_frost"}


def test_the_two_travelling_sets_differ_only_by_the_turning_points():
    assert build.SEASON_BADGES - build.YEAR_BADGES == TURNING_POINTS
    assert build.YEAR_BADGES - build.SEASON_BADGES == set()


def test_every_travelling_badge_is_a_badge():
    """A key that no longer names a rule sits in the set forever, judged at nothing."""
    keys = {b["key"] for b in build.BADGES}
    assert build.SEASON_BADGES <= keys
    assert build.YEAR_BADGES <= keys


def test_the_carbon_badges_are_judged_at_the_season_scale():
    """Each is a rank or a z-score against the span's own peers, so each travels as far as any."""
    carbon = {"record_sink", "record_source", "sink_strong", "sink_weak", "gpp_high", "gpp_low"}
    assert carbon <= build.SEASON_BADGES
    for key in carbon:
        badge = next(b for b in build.BADGES if b["key"] == key)
        assert build.badge_at_scale(badge, "season") is True
        assert build.badge_at_scale(badge, "year") is True


def test_a_season_earns_a_carbon_badge(flux_atlas):
    """The set says they are judged there; this says one actually lands."""
    carbon = {"record_sink", "record_source", "sink_strong", "sink_weak", "gpp_high", "gpp_low"}
    earned = {b["k"] for row in flux_atlas.payload["seasons"] for b in row["b"]}
    assert carbon & earned, "no season of the record earned any carbon badge"


def test_the_legend_names_the_scales_a_badge_is_actually_judged_at(flux_atlas):
    """`scales` drives "not judged at this scale" in the legend, so it has to agree with the rule."""
    by_key = {b["key"]: b for b in build.BADGES}
    for meta in flux_atlas.payload["badges"]:
        badge = by_key[meta["key"]]
        assert meta["scales"] == [sc for sc in ("month", "season", "year")
                                  if build.badge_at_scale(badge, sc)]
        # A badge counted at a scale it is not judged at is the mismatch this guards against.
        for scale, n in (("season", meta["n_season"]), ("year", meta["n_year"])):
            if scale not in meta["scales"]:
                assert n == 0, f"{meta['key']} is counted at the {scale} scale it is withheld from"


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
    assert any(item["v"].startswith("Warmest of 12 years") for item in warmest["stood"])


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


def test_a_record_too_short_for_a_normal_states_no_placing(tmp_path):
    """`net_sink` and `net_source` are judged without a normal, but quote a rank out of one.

    Both carry `needs_normal=False`, so they are evaluated on a record shorter than
    `MIN_NORMAL_YEARS`; the rank they print is counted out of the normal's qualifying years, which
    that record has none of. The badge read "3rd largest uptake of None years" on every year tile -
    and the form it replaced raised a TypeError in the same state, so the failure was loud before
    it was silent.
    """
    frame = add_fluxes(synthetic_frame(years=5))
    path = tmp_path / "short.parquet"
    frame.to_parquet(path)

    atlas = fa.Atlas(path, ["NEE"], hourly=False, quiet=True)
    assert atlas.payload["years"][0]["NEE"]["n"] is None,         "five years is meant to be too short for a year-scale normal; the fixture has changed"

    earned = [b for row in atlas.payload["years"] for b in row["b"]
              if b["k"] in ("net_sink", "net_source")]
    assert earned, "the carbon badges are the point of this test and none was awarded"
    for badge in earned:
        assert "None" not in badge["t"], badge["t"]
        assert "of  years" not in badge["t"], badge["t"]


def test_a_year_that_lost_carbon_states_its_placing(tmp_path):
    """`net_source` is never awarded on the synthetic record, so its rule body never runs.

    Every one of the twelve synthetic years is a net sink, which leaves the sibling badge's text -
    including the rank it quotes, and the direction it names - entirely unexecuted. Weakening
    photosynthesis and recomputing the net flux from the partitioning identity turns the site into
    a source without disturbing anything else the fixture is built to carry.
    """
    frame = add_fluxes(synthetic_frame())
    frame["GPP_NT_VUT_REF"] = frame["GPP_NT_VUT_REF"] * 0.35
    frame["NEE_VUT_REF"] = frame["RECO_NT_VUT_REF"] - frame["GPP_NT_VUT_REF"]
    for pct, factor in zip(("16", "25", "50", "75", "84"), (0.90, 0.95, 1.00, 1.05, 1.10)):
        frame[f"NEE_VUT_{pct}"] = frame["NEE_VUT_REF"] * factor
    path = tmp_path / "source.parquet"
    frame.to_parquet(path)

    atlas = fa.Atlas(path, ["NEE"], hourly=False, quiet=True)
    earned = {b["k"] for row in atlas.payload["years"] for b in row["b"]}
    assert "net_source" in earned and "net_sink" not in earned

    text = next(b["t"] for row in atlas.payload["years"] for b in row["b"]
                if b["k"] == "net_source")
    assert "Net release of" in text
    assert "largest release of" in text, text
    assert "None" not in text, text


# -- Placings from either end --------------------------------------------------------------------
#
# Ranks are taken with `method="min"`, so tied values share the lower rank. Counting the far end as
# `n - rank + 1` then puts a year tied for last one place away from the end it is at; the far end has
# its own rank for that reason, and the account of a year has to read it.

def _year(value, rank, rank_far, n=12, key="TA", gslen=None, peers_gslen=None, nrec=0):
    """The statistics of one year, as far as `year_standout` reads them."""
    return {key: value, f"{key}_z": 0.5, f"{key}_rank": rank, f"{key}_rank_far": rank_far,
            f"{key}_n": n, f"{key}_anom": 0.1, f"{key}_unc": None, "worst_month": None,
            "ev_gslen": None if gslen is None else dict(days=gslen, delta=None, normal=None),
            "ev_frostfree": None, "x": dict(nx=0, nrec=nrec, gslen=gslen, frostfree=None)}


def _loaded(*keys):
    from fluxatlas import variables
    return {key: {"v": variables.make(key)} for key in keys}


def test_a_year_tied_for_the_far_end_is_placed_at_it():
    """Two years share the lowest mean; each is the coldest, not the second coldest."""
    tied = _year(8.0, rank=11, rank_far=1)
    peers = [_year(9.0 + i / 10, rank=i + 1, rank_far=12 - i) for i in range(10)]
    peers += [tied, _year(8.0, rank=11, rank_far=1)]
    stood = build.year_standout(tied, peers, ["TA"], _loaded("TA"))
    line = next(item["v"] for item in stood if item["k"] == "Air temperature")
    assert line.startswith("Coldest of 12 years"), line


def test_a_placing_near_the_top_names_the_top():
    year = _year(10.0, rank=2, rank_far=11)
    stood = build.year_standout(year, [year], ["TA"], _loaded("TA"))
    line = next(item["v"] for item in stood if item["k"] == "Air temperature")
    assert line.startswith("2nd warmest of 12 years"), line


def test_a_growing_season_tied_for_shortest_is_the_shortest():
    lengths = [250, 245, 240, 235, 230, 225, 220, 215, 210, 205, 200, 200]
    peers = [_year(9.0, rank=None, rank_far=None, gslen=days) for days in lengths]
    stood = build.year_standout(peers[-1], peers, [], {})
    line = next(item["v"] for item in stood if item["k"] == "Growing season")
    assert "Shortest of 12 years" in line, line


def test_record_days_near_the_bottom_are_called_the_fewest():
    counts = [120, 110, 100, 95, 90, 85, 80, 75, 70, 65, 60, 60]
    peers = [_year(9.0, rank=None, rank_far=None, nrec=c) for c in counts]
    stood = build.year_standout(peers[-1], peers, [], {})
    line = next(item["v"] for item in stood if item["k"] == "Record days")
    assert line.endswith("the fewest of 12 years."), line


def test_a_sink_year_at_the_top_of_the_nee_ranking_is_the_smallest_uptake(flux_atlas):
    """Every synthetic year is a sink, so the top of the ranking releases nothing.

    The registry's word for that end is "largest net release", which describes no year of this
    record. The placing follows the side of zero the year is on instead.
    """
    years = [row for row in flux_atlas.payload["years"] if row["NEE"]["v"] is not None]
    assert all(row["NEE"]["v"] < 0 for row in years), "the fixture is meant to be all sinks"
    weakest = max(years, key=lambda row: row["NEE"]["v"])
    strongest = min(years, key=lambda row: row["NEE"]["v"])
    lines = {row["y"]: next(item["v"] for item in row["stood"] if item["k"] == "Carbon balance")
             for row in years}
    assert lines[weakest["y"]].endswith(f"smallest net uptake of {len(years)} years."),         lines[weakest["y"]]
    assert lines[strongest["y"]].endswith(f"largest net uptake of {len(years)} years."),         lines[strongest["y"]]
    assert not any("release" in line for line in lines.values())


def test_a_nee_placing_that_crosses_zero_names_neither_side():
    """A weak sink with two sources above it is not the third-smallest uptake of anything."""
    values = [-120.0, -100.0, -80.0, -60.0, -50.0, -40.0, -30.0, -20.0, -10.0, -5.0, 10.0, 30.0]
    peers = [_year(v, rank=i + 1, rank_far=12 - i, key="NEE") for i, v in enumerate(values)]
    stood = build.year_standout(peers[9], peers, ["NEE"], _loaded("NEE"))
    line = next(item["v"] for item in stood if item["k"] == "Carbon balance")
    assert line.endswith("3rd highest of 12 years."), line
    source = build.year_standout(peers[11], peers, ["NEE"], _loaded("NEE"))
    line = next(item["v"] for item in source if item["k"] == "Carbon balance")
    assert line.endswith("largest net release of 12 years."), line
