"""The per-variable pages: one page per variable, built from what the grid already carries.

Nothing here is computed twice. A variable's page states the slope the grid's foot row prints, the
calendar-month normals the anomalies are taken against, and the coverage the warnings rest on, so
what the tests guard is that the payload carries those in the form the page reads them, and that
the page cannot draw a line disagreeing with the number printed beside it.
"""

from __future__ import annotations

import pytest

from fluxatlas import build


# -- What the page needs from the payload --------------------------------------------------------

def test_each_variable_names_the_metric_that_reads_it_directly(full_atlas):
    """The page is about the variable, so it takes its trend from the metric on the product."""
    keys = {m["key"]: m for m in full_atlas.payload["metrics"]}
    for v in full_atlas.payload["variables"]:
        if v["metric"] is None:
            continue
        metric = keys[v["metric"]]
        assert metric["var"] == v["key"]
        assert metric["field"] == "value"


def test_a_variable_page_can_state_a_slope_for_every_calendar_month(full_atlas):
    """"The trend of January" is the statement this page exists for, so all twelve are shipped."""
    ta = next(m for m in full_atlas.payload["metrics"] if m["key"] == "TA")
    assert set(ta["trend"]) == {str(m) for m in range(1, 13)}
    for slope in ta["trend"].values():
        assert "n" in slope
        if "slope" in slope:
            assert slope["lo"] <= slope["slope"] <= slope["hi"]
            assert slope["n"] >= build.TREND_MIN_YEARS


def test_the_fitted_line_is_the_slope_it_is_drawn_beside(full_atlas):
    """The page draws the build's own fit rather than fitting one in the browser."""
    for metric in full_atlas.payload["metrics"]:
        # The coverage metric carries no slope at all: fitting a trend through how well measured
        # the well-measured months are would be circular.
        if metric["trend"] is None:
            assert metric["field"] == "meas"
            continue
        for trend in list(metric["trend"].values()) + [metric["trend_year"]]:
            if not trend or "slope" not in trend:
                continue
            rise = (trend["fit"][1] - trend["fit"][0]) / (trend["y1"] - trend["y0"]) * 10
            assert rise == pytest.approx(trend["slope"], abs=1e-3)


def test_the_climatology_carries_the_spread_a_normal_is(full_atlas):
    """A normal is a distribution, and the page's annual cycle draws it as one."""
    clim = full_atlas.payload["climatology"]["TA"]
    assert set(clim) == {str(m) for m in range(1, 13)}
    for month in clim.values():
        if month is None:
            continue
        assert month["min"] <= month["mean"] <= month["max"]
        assert month["sd"] >= 0
        assert month["n"] >= build.MIN_NORMAL_YEARS
        assert month["min_year"] and month["max_year"]


def test_a_variable_carries_what_its_page_says_about_the_record(full_atlas):
    for v in full_atlas.payload["variables"]:
        assert v["column"] and v["units"] and v["about"]
        assert v["first_year"] <= v["last_year"]
        assert set(v["cov"]) == {"badge", "normal", "warn"}
        assert v["agg"] in ("mean", "sum")


def test_the_coverage_chart_has_a_figure_per_year(full_atlas):
    """The page's last chart qualifies every one above it, so both shares travel per year."""
    for row in full_atlas.payload["years"]:
        for v in full_atlas.payload["variables"]:
            rec = row[v["key"]]
            assert rec["avail"] is None or 0 <= rec["avail"] <= 100
            assert rec["meas"] is None or 0 <= rec["meas"] <= 100


# -- The renderer --------------------------------------------------------------------------------

def test_the_page_has_a_view_and_a_route_for_one_variable(full_atlas, tmp_path):
    js = (build.ASSETS / "calendar.js").read_text(encoding="utf-8")
    template = (build.ASSETS / "template.html").read_text(encoding="utf-8")
    assert 'id="view-var"' in template
    assert 'id="var-body"' in template
    assert "^var-(" in js, "the router does not recognise a variable address"
    assert "function renderVariable" in js

    # The links themselves are built in the browser from the payload's own variable list, so what
    # can be asserted here is that both halves exist: the index that writes them, and the payload
    # it writes them from.
    assert "renderVarIndex" in js and '"#var-\' + v.key' in js
    html = full_atlas.write(tmp_path / "atlas.html", quiet=True).read_text(encoding="utf-8")
    assert 'id="varindex"' in html
    for v in full_atlas.payload["variables"]:
        assert f'"key": "{v["key"]}"' in html or f'"key":"{v["key"]}"' in html


def test_the_renderer_reads_no_colour_the_palette_does_not_carry():
    """A chart asking for `p.band` draws with `undefined` and fails silently on the page."""
    js = (build.ASSETS / "calendar.js").read_text(encoding="utf-8")
    known = {"series", "cold", "warm", "mid", "bandOuter", "bandInner", "ink", "ink2", "muted",
             "axis", "grid", "surface"}
    import re
    used = set(re.findall(r"\bf\.p\.([A-Za-z]+)", js))
    assert used <= known, f"the palette has no {', '.join(sorted(used - known))}"
