"""The payload's shape, the rules that keep its claims honest, and the rendered page."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import pandas as pd
import pytest

from conftest import synthetic_frame

import fluxatlas as fa
from fluxatlas import build


# -- Shape ---------------------------------------------------------------------------------------

def test_the_grid_is_a_whole_number_of_years(full_atlas):
    years = full_atlas.last_year - full_atlas.first_year + 1
    assert len(full_atlas.payload["months"]) == years * 12
    assert len(full_atlas.payload["seasons"]) == years * 4


def test_every_month_addresses_a_real_window_of_the_daily_arrays(full_atlas):
    n_days = full_atlas.payload["days"]["n"]
    for row in full_atlas.payload["months"]:
        assert 0 <= row["i0"] < n_days
        assert row["i0"] + row["n"] <= n_days


def test_the_daily_series_are_as_long_as_the_record(full_atlas):
    days = full_atlas.payload["days"]
    for name, series in days["series"].items():
        assert len(series) == days["n"], f"{name} is not the length of the record"
    for key, series in days["meas"].items():
        assert len(series) == days["n"]


def test_the_payload_is_json_serializable_without_nan(full_atlas):
    """`allow_nan=False` is what the renderer uses; NaN is not valid JSON."""
    text = json.dumps(full_atlas.payload, allow_nan=False)
    assert len(text) > 10_000


def test_the_hourly_layer_can_be_left_out(parquet_path):
    small = fa.Atlas(parquet_path, ["TA"], hourly=False, quiet=True)
    assert small.payload["hourly"] is None


# -- The rules that keep a claim honest ------------------------------------------------------------

def test_a_normal_needs_enough_qualifying_years(full_atlas):
    """Below MIN_NORMAL_YEARS there is no normal, and so no anomaly and no z-score.

    A rank is deliberately not part of this: it is gated on coverage rather than on the normal, so
    a calendar month with three well-measured years ranks those three against each other while
    having too few for a normal. Both rules are inherited from the CH-LAE original.
    """
    for row in full_atlas.payload["months"]:
        for key in full_atlas.variables:
            block = row[key]
            if block["n"] is None:
                assert block["a"] is None and block["z"] is None
            else:
                assert block["n"] >= build.MIN_NORMAL_YEARS


def test_a_month_the_record_does_not_cover_is_not_ranked(full_atlas):
    """Ranking is gated on availability, not on how much of the month was measured.

    The gap-filled product is what the page is of, so a thinly measured month is ranked like any
    other and marked rather than withheld. A month the record does not reach at all still has
    nothing to rank.
    """
    for row in full_atlas.payload["months"]:
        for key in full_atlas.variables:
            block = row[key]
            if block["r"] is not None:
                assert block["avail"] >= build.NORMAL_MIN_COVERAGE


def test_the_renderer_has_no_statement_break_inside_a_card_literal():
    """A stray semicolon in `chartCard({...})` blanks the whole page, and nothing else catches it.

    The renderer is one IIFE. A syntax error anywhere in it means the script never runs, so the
    page loads its markup, renders nothing, and reports no error a reader would see. pytest cannot
    execute the renderer, and a full JS parser is not a dependency worth taking on, so this asserts
    the one shape that has actually caused it: a continuation line of a concatenated string that
    ends the statement instead of the string.

        + nf(TREND_ALPHA, 2); outlined bars are not.',      <- meant to be inside the quotes

    The rule is narrow on purpose. Ending a continuation line with `;` is ordinary and correct; the
    tell is a semicolon with prose still following it, which means the quote that should have
    enclosed it is missing.
    """
    js = (Path(build.__file__).parent / "assets" / "calendar.js").read_text(encoding="utf-8")
    offenders = []
    for n, line in enumerate(js.splitlines(), 1):
        body = line.strip()
        if not body.startswith("+"):
            continue
        # Drop the paired string literals. An unterminated one leaves its own quote behind, which
        # is exactly the state a swallowed quote produces.
        outside = re.sub(r"'(?:[^'\\]|\\.)*'", "", body)
        if re.search(r";\s*\S", outside):
            offenders.append(f"{n}: {body[:70]}")
    assert not offenders, (
        "a continuation line ends its statement outside a string, which stops the whole renderer "
        "parsing:\n  " + "\n  ".join(offenders))


def test_a_trend_states_the_years_it_rests_on(full_atlas):
    for metric in full_atlas.payload["metrics"]:
        for trend in list((metric.get("trend") or {}).values()) + [metric.get("trend_year")]:
            if not trend:
                continue
            assert "n" in trend
            if "slope" in trend:
                assert trend["n"] >= build.TREND_MIN_YEARS
                assert trend["lo"] <= trend["slope"] <= trend["hi"]


def test_the_imposed_warming_is_found(parquet_path):
    """The fixture warms by 0.8 K/decade, so the atlas's own trend estimator should say so."""
    atlas = fa.Atlas(parquet_path, ["TA"], hourly=False, quiet=True)
    ta = next(m for m in atlas.payload["metrics"] if m["key"] == "TA")
    assert ta["trend_year"]["slope"] == pytest.approx(0.8, abs=0.35)


def test_no_month_reports_more_threshold_days_than_it_has(full_atlas):
    for row in full_atlas.payload["months"]:
        for key, count in row["c"].items():
            assert 0 <= count <= 31
        for key, spell in row["sp"].items():
            assert 0 <= spell <= 31


# -- Rendering -------------------------------------------------------------------------------------

def test_the_page_is_one_self_contained_file(ta_atlas, tmp_path):
    out = ta_atlas.write(tmp_path / "atlas.html", quiet=True)
    html = out.read_text(encoding="utf-8")
    assert html.lstrip().lower().startswith("<!doctype html")
    # Nothing may be fetched at view time: the page has to work from a memory stick.
    assert not re.search(r'<(script|link)[^>]+(src|href)="(https?:)?//', html)
    assert "__DATA__" not in html and "__CSS__" not in html and "__JS__" not in html
    assert "__LOGO__" not in html and "__FAVICON__" not in html


def test_the_payload_cannot_close_the_script_tag_early(ta_atlas, tmp_path):
    out = ta_atlas.write(tmp_path / "atlas.html", quiet=True)
    html = out.read_text(encoding="utf-8")
    body = html.split("</script>")[0]
    assert "<!--" not in body.split("<script")[-1]


def test_the_title_reports_the_site_and_the_span(ta_atlas, tmp_path):
    out = ta_atlas.write(tmp_path / "atlas.html", quiet=True)
    html = out.read_text(encoding="utf-8")
    assert f"XX-Syn" in html
    assert str(ta_atlas.first_year) in html and str(ta_atlas.last_year) in html


def test_a_title_can_be_overridden(ta_atlas, tmp_path):
    out = ta_atlas.write(tmp_path / "atlas.html", title="A stated title", quiet=True)
    assert "<title>A stated title</title>" in out.read_text(encoding="utf-8")


def test_the_logo_is_inlined_and_is_also_the_favicon(ta_atlas, tmp_path):
    """One mark, two uses. The favicon has to be a data URI or the page stops being one file."""
    out = ta_atlas.write(tmp_path / "atlas.html", quiet=True)
    html = out.read_text(encoding="utf-8")
    logo = (Path(build.__file__).parent / "assets" / "logo.svg").read_text(encoding="utf-8").strip()

    assert logo in html, "the mark is not inlined in the topbar"
    href = re.search(r'<link rel="icon" href="([^"]+)">', html)
    assert href, "no favicon"
    encoded = href.group(1)
    assert encoded.startswith("data:image/svg+xml;base64,")
    assert base64.b64decode(encoded.split(",", 1)[1]).decode("utf-8") == logo, \
        "the favicon and the topbar mark have drifted apart"


def test_the_logo_carries_no_reference_the_page_would_have_to_fetch(ta_atlas, tmp_path):
    """A favicon data URI cannot resolve an external href, and neither can a memory stick."""
    logo = (Path(build.__file__).parent / "assets" / "logo.svg").read_text(encoding="utf-8")
    assert not re.search(r"(https?:)?//", logo.replace("http://www.w3.org/2000/svg", ""))
    assert "<image" not in logo and "url(" not in logo


def test_writing_twice_does_not_rebuild(ta_atlas, tmp_path):
    first = ta_atlas.write(tmp_path / "one.html", quiet=True)
    second = ta_atlas.write(tmp_path / "two.html", quiet=True)
    assert first.read_bytes() == second.read_bytes()


# -- The public surface ----------------------------------------------------------------------------

def test_build_atlas_reads_builds_and_writes_in_one_call(parquet_path, tmp_path):
    out = fa.build_atlas(parquet_path, tmp_path / "atlas.html", variables=["TA"],
                         hourly=False, quiet=True)
    assert out.exists() and out.stat().st_size > 100_000


def test_the_site_is_read_out_of_a_fluxnet_file_name(csv_path, tmp_path):
    atlas = fa.Atlas(csv_path, ["TA"], hourly=False, quiet=True)
    assert atlas.site == "XX-Syn"


def test_available_and_known_variables_are_exported(parquet_path):
    assert set(fa.available(parquet_path)) == {"TA", "PREC", "SW_IN"}
    assert "TA" in fa.known_variables()


def test_every_badge_asks_for_an_icon_the_page_can_draw():
    """A badge asking for an icon the renderer does not know would render as an empty box."""
    js = (Path(build.__file__).parent / "assets" / "calendar.js").read_text(encoding="utf-8")
    icons = set(re.findall(r"^\s{4}'([\w-]+)':", js, flags=re.M))
    assert icons, "no icons found in the renderer - the extraction pattern has drifted"
    for badge in build.BADGES:
        assert badge["icon"] in icons, f"badge {badge['key']} wants icon {badge['icon']}"


def test_every_day_test_has_a_short_name():
    """Without one the page prints the key itself where it lists tests on a tile."""
    for group in build.EXTRA_INDICES.values():
        for item in group:
            assert item["key"] in build.FLAG_SHORT
    for item in build.DERIVED_FLAGS:
        assert item["key"] in build.FLAG_SHORT


def test_a_tie_at_the_far_end_still_earns_the_record_badge():
    """`method="min"` gives tied spans the lower rank, so no span holds rank n.

    The record badges for the far end - coldest, driest, worst carbon balance - used to test
    `rank == n`, which two spans tying at that end makes unreachable: both take rank n-1 and the
    badge is silently never awarded. Ranking from the far end instead makes the claim `rank == 1`,
    which a tie satisfies for both, exactly as it already did at the near end.
    """
    years = list(range(2010, 2022))
    value = pd.Series([5.0, 4.0, 3.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 1.0, 1.0],
                      index=pd.Index(years, dtype="int64"))
    frames = {"TA": dict(value=value, meas=pd.Series(100.0, index=value.index),
                         avail=pd.Series(100.0, index=value.index), unc=None)}
    norm = build.normals(frames, [1] * len(years), years)["TA"]

    n = norm["by_group"][1]["n"]
    assert not [y for y, r in zip(years, norm["ranks"]) if r == n],         "the tie is the point of this test; without one the old form would have worked"
    assert [y for y, r in zip(years, norm["ranks_far"]) if r == 1] == [2020, 2021]


def test_a_tie_at_the_far_end_earns_the_badge_on_every_tied_span(tmp_path):
    """The other half of the tie: `normals` ranking correctly is not the same as a badge firing.

    Reverting only the four badge rules to `rank == n` leaves the whole suite passing, because the
    synthetic record has no ties. Two Januaries with no precipitation at all is the input that
    separates them: under the old rule the January column awards `record_dry` to nobody, since
    `method="min"` gives both tied months rank n-1 and no month ever holds n.
    """
    frame = synthetic_frame()
    for year in (2013, 2017):
        frame.loc[f"{year}-01", "P_F"] = 0.0
    path = tmp_path / "tied.parquet"
    frame.to_parquet(path)

    atlas = fa.Atlas(path, ["TA", "PREC"], hourly=False, quiet=True)
    driest = sorted(row["y"] for row in atlas.payload["months"]
                    if row["m"] == 1 and any(b["k"] == "record_dry" for b in row["b"]))
    assert driest == [2013, 2017]


def test_the_hourly_layer_is_a_whole_number_of_days(tmp_path):
    """Nothing else in the suite builds with `hourly=True`, so this layer is never exercised.

    Every fixture and every command-line test passes `--no-hourly`, which is the right default for
    a suite that builds a page per test - but it leaves the arrays behind the day panel's diurnal
    charts, and the check on their length, unreachable. Two years is enough to shape-check them.
    """
    frame = synthetic_frame(years=2)
    path = tmp_path / "hourly.parquet"
    frame.to_parquet(path)

    atlas = fa.Atlas(path, ["TA"], hourly=True, quiet=True)
    hourly = atlas.payload["hourly"]
    assert hourly["start"] == "2010-01-01"
    assert hourly["n"] % 24 == 0
    assert hourly["n"] == (365 + 365) * 24
    assert len(hourly["vars"]["TA"]["values"]) == hourly["n"]

    without = fa.Atlas(path, ["TA"], hourly=False, quiet=True)
    assert without.payload["hourly"] is None


def test_a_percentage_of_normal_is_stated_only_for_a_quantity_with_a_true_zero(full_atlas):
    """Sixty percent of normal is a statement about rain and an artefact for degrees Celsius."""
    months = full_atlas.payload["months"]
    assert any(row["PREC"]["p"] is not None for row in months)
    assert all(row["TA"]["p"] is None for row in months)


def test_the_thin_span_warning_says_what_was_used(capsys):
    """A variable with no flag has gaps, not filling, and the warning must not say otherwise."""
    thin = {"RH": dict(warn=50.0, n=3, n_total=24, lowest=12.0, worst="March 2011", flagged=False),
            "TA": dict(warn=50.0, n=1, n_total=24, lowest=40.0, worst="May 2012", flagged=True)}
    build.report_thin_spans(thin)
    out = capsys.readouterr().out
    rh = next(line for line in out.splitlines() if "RH" in line)
    ta = next(line for line in out.splitlines() if "TA" in line)
    assert "values present are used" in rh and "gap-filled" not in rh
    assert "gap-filled values are used" in ta
