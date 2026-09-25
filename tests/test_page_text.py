"""What the page says about a site has to be true of the site it is built for.

The badge, metric and variable text was written against CH-LAE, a mixed forest on a ridge, and
some of it said so without saying so: a relative humidity of 95 % was "the tower inside low cloud"
because that tower stands 47 m up a ridge, the soil water was "homogenised across the 2020 sensor
change", and the annual carbon balance belonged to the year because "at this site" the summers
were sinks. On a cropland in a valley or a site south of the equator each of those is false, and
the page is read by people deciding whether to cite it.
"""

from __future__ import annotations

import re

import pytest

from conftest import add_fluxes, add_fullset_extras, synthetic_frame
import fluxatlas as fa
from fluxatlas import build, variables as varreg

# Phrases that are a fact about one site, one sensor history or one ecosystem.
SITE_FACTS = [
    r"47 m", r"\bridge\b", r"sensor change", r"homogeni[sz]ed", r"\bat this site\b",
    r"the tower inside", r"\bsummer month is a sink\b", r"\bwinter month a source\b",
    r"about four land", r"\bclose stomata\b",
]


def reader_visible_strings():
    """Every registry string that reaches the page: labels, abouts, day-test labels, subtitles."""
    out = []
    for badge in build.BADGES:
        out += [("badge " + badge["key"], badge[k]) for k in ("label", "about")]
    for metric in build.METRICS:
        out += [("metric " + metric["key"], metric[k]) for k in ("label", "short", "about")]
    for flag in build.DERIVED_FLAGS:
        out.append(("day test " + flag["key"], flag["label"]))
    for key, items in build.EXTRA_INDICES.items():
        out += [("index " + i["key"], i["label"]) for i in items]
    out += [("flag short " + k, v) for k, v in build.FLAG_SHORT.items()]
    for key in varreg.known():
        v = varreg.make(key)
        out += [("variable " + key, v.title), ("variable " + key, v.about)]
        for group in v.index_groups:
            out += [("variable " + key, group["title"]), ("variable " + key, group.get("sub", ""))]
            out += [("variable " + key, i["label"]) for i in group["items"]]
    return out


@pytest.mark.parametrize("pattern", SITE_FACTS)
def test_no_string_on_the_page_states_a_fact_about_one_site(pattern):
    hits = [(where, text) for where, text in reader_visible_strings()
            if re.search(pattern, text, flags=re.IGNORECASE)]
    assert not hits, hits


def test_the_composite_names_the_axes_the_build_has(tmp_path):
    """Four axes, not five: the metric is offered on four, so its text has to say four."""
    frame = add_fullset_extras(add_fluxes(synthetic_frame()))
    path = tmp_path / "four_axes.parquet"
    frame.to_parquet(path)
    atlas = fa.Atlas(path, ["TA", "PREC", "SW_IN", "VPD"], site="XX-Syn", hourly=False,
                     quiet=True)
    about = next(m["about"] for m in atlas.payload["metrics"] if m["key"] == "nsd")
    assert "four variables" in about
    assert "five" not in about
    assert "soil water" not in about
    for key in ("TA", "PREC", "SW_IN", "VPD"):
        assert varreg.make(key).title.lower() in about
    assert "{" not in about


def test_every_axis_is_named_when_the_build_has_all_five(tmp_path):
    frame = add_fullset_extras(add_fluxes(synthetic_frame()))
    path = tmp_path / "five_axes.parquet"
    frame.to_parquet(path)
    atlas = fa.Atlas(path, ["TA", "PREC", "SW_IN", "VPD", "SWC"], site="XX-Syn", hourly=False,
                     quiet=True)
    about = next(m["about"] for m in atlas.payload["metrics"] if m["key"] == "nsd")
    assert "five variables" in about
    assert "soil water content" in about
