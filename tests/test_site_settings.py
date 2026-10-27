"""The site settings: what a build can say about a variable beyond the column it is read from.

A source flag, a fill legend of the site's own, measured codes, instances of one variable at several
depths, a variable's own years, the uncorrected twin of a corrected series, a reference station and
the site's notes. Each is opt-in, so each is tested here on what it adds; that a build naming none of
them is unchanged is `test_payload_regression.py`.

The data are `conftest.add_site_extras`, built so that every figure asserted here is known before
the build runs: a correction of exactly +1.3 °C before a sensor change, a reference station exactly
0.5 °C colder, a soil depth that begins in the fourth year.
"""

from __future__ import annotations

import json
import re

import pandas as pd
import pytest

import fluxatlas as fa
from conftest import add_fullset_extras, add_site_extras, reference_frame
from fluxatlas import cli, compare
from fluxatlas import variables as varreg

SOURCE_LEGEND = {0: ("new sensor", "new"), 1: ("old sensor", "old"), 2: ("changeover", "change")}
FILL_LEGEND = {0: ("measured", "measured"), 4: ("linear interpolation", "interpolated"),
               5: ("reconstructed from a neighbour", "reconstructed")}
TS_LEGEND = {0: ("no value", "none"), 1: ("current profile", "current"),
             2: ("early profile", "early"), 3: ("modelled from other depths", "modelled")}


@pytest.fixture(scope="module")
def site_frame(flux_frame):
    return add_site_extras(add_fullset_extras(flux_frame.copy()))


@pytest.fixture(scope="module")
def site_path(site_frame, tmp_path_factory):
    path = tmp_path_factory.mktemp("site") / "XX-Syn_site.parquet"
    site_frame.to_parquet(path)
    return path


@pytest.fixture(scope="module")
def reference_path(site_frame, tmp_path_factory):
    path = tmp_path_factory.mktemp("site") / "reference.parquet"
    reference_frame(site_frame).to_parquet(path)
    return path


def site_variables(**extra):
    """Every setting at once, the way a site with a full product would name them."""
    out = {
        "TA": dict(column="TA_SITE", qc="TA_SITE_FLAG", qc_legend=FILL_LEGEND,
                   raw="TA_SITE_RAW",
                   source=dict(column="TA_SITE_SOURCE", legend=SOURCE_LEGEND, reference_code=0),
                   reference=dict(column="TA_REF", split=True),
                   notes=["Measured at 2 m; {units} throughout."],
                   correction_note="Raised by {offset} before {break_ts}, cooled by up to "
                                   "{shield_max} after it."),
        "PA": dict(column="PA_F", reference=dict(column="PA_REF", factor=0.1)),
        "SWC@0.05": dict(column="SWC_5", first_year=2013, title="Soil water content at 0.05 m"),
        "SWC@0.3": dict(column="SWC_30", source=dict(column="SWC_30_SOURCE")),
        "TS@0.1": dict(column="TS_10", qc="TS_10_METHOD", qc_legend=TS_LEGEND,
                       measured_codes=(1, 2), source=dict(column="TS_10_METHOD", legend=TS_LEGEND)),
        "SW_OUT": "SW_OUT",
        "LW_OUT": "LW_OUT",
    }
    out.update(extra)
    return out


@pytest.fixture(scope="module")
def site_atlas(site_path, reference_path):
    return fa.Atlas(site_path, site_variables(), site="XX-Syn", hourly=False, quiet=True,
                    primary={"SWC": "SWC@0.3"}, lat=47.5, lon=8.4, utc_offset=1,
                    reference=dict(file=reference_path, station="Syn reference", distance_km=2.0,
                                   elevation_m=600, shift=-15))


def entry(atlas, key):
    return next(v for v in atlas.payload["variables"] if v["key"] == key)


# -- Outgoing radiation ----------------------------------------------------------------------------

def test_outgoing_radiation_is_in_the_registry_and_is_not_built_unasked(site_path):
    for key in ("SW_OUT", "LW_OUT"):
        v = varreg.make(key)
        assert v.units == "W m⁻²" and v.agg == "mean" and not v.default
    assert varreg.make("SW_OUT").extremes["low_halfhour"] is False
    found = fa.available(site_path)
    assert found["SW_OUT"]["column"] == "SW_OUT" and found["LW_OUT"]["column"] == "LW_OUT"
    assert "SW_OUT" not in fa.Atlas(site_path, None, quiet=True, hourly=False).variables


def test_the_net_radiation_recipe_still_names_the_outgoing_terms():
    assert varreg.VARIABLES["NETRAD"]["derived"]["terms"][1][1] == ["SW_OUT", "SW_OUT_1_1_1"]
    assert varreg.VARIABLES["NETRAD"]["derived"]["terms"][3][1] == ["LW_OUT", "LW_OUT_1_1_1"]


# -- Instances ------------------------------------------------------------------------------------

def test_an_instance_inherits_everything_but_its_column():
    v = varreg.make("TS@0.15")
    base = varreg.make("TS")
    assert (v.key, v.base, v.instance) == ("TS@0.15", "TS", "0.15")
    assert (v.units, v.limits, v.agg, v.digits, v.about) == (base.units, base.limits, base.agg,
                                                             base.digits, base.about)
    assert varreg.coverage("TS@0.15") == varreg.coverage("TS")
    for bad in ("TS@", "XX@1", "TS@a b"):
        assert not varreg.is_known(bad)


def test_an_instance_must_name_its_column(site_path):
    with pytest.raises(KeyError, match="names no column"):
        fa.Atlas(site_path, ["SWC@0.2"], quiet=True)


def test_each_instance_has_its_own_entry_and_metric(site_atlas):
    keys = [v["key"] for v in site_atlas.payload["variables"]]
    assert "SWC@0.05" in keys and "TS@0.1" in keys
    metrics = {m["key"]: m for m in site_atlas.payload["metrics"]}
    assert metrics["SWC@0.05"]["var"] == "SWC@0.05"
    assert metrics["TS@0.1"]["label"].startswith("Soil temperature (0.1)")
    assert entry(site_atlas, "SWC@0.05")["title"] == "Soil water content at 0.05 m"


def test_the_primary_instance_stands_in_for_its_plain_key(site_atlas):
    swc = entry(site_atlas, "SWC")
    assert swc["column"] == "SWC_30" and swc["instance"] == "0.3"
    assert "SWC@0.3" not in [v["key"] for v in site_atlas.payload["variables"]]
    assert site_atlas.payload["meta"]["primary"] == {"SWC": "SWC@0.3"}
    # The soil badges read the plain key, so they are judged rather than withheld as absent.
    absent = {s["key"] for row in site_atlas.payload["months"] for s in row["sup"]
              if s["c"] == "absent"}
    assert "soil_dry" not in absent


def test_an_instance_carries_no_day_tests_and_does_not_mark_a_span_sparse(site_atlas):
    assert not [f for f in site_atlas.payload["flags"] if "@" in f["var"]]
    # SWC@0.05 is missing through its first three years, which would mark every one of their
    # months sparse if an instance took part in the badge.
    early = [row for row in site_atlas.payload["months"] if row["y"] < 2013]
    reasons = [b["t"] for row in early for b in row["b"] if b["k"] == "sparse"]
    assert not any("SWC@0.05" in t for t in reasons)


def test_primary_is_checked_before_the_file_is_read(site_path):
    with pytest.raises(KeyError, match="not among the variables"):
        fa.Atlas(site_path, {"TA": "TA_F"}, primary={"SWC": "SWC@0.3"}, quiet=True)
    with pytest.raises(KeyError, match="leave one of the two out"):
        fa.Atlas(site_path, {"SWC": "SWC_F_MDS_1", "SWC@0.3": "SWC_30"},
                 primary={"SWC": "SWC@0.3"}, quiet=True)
    with pytest.raises(KeyError, match="not an instance of SWC"):
        fa.Atlas(site_path, {"TS@0.1": "TS_10"}, primary={"SWC": "TS@0.1"}, quiet=True)


# -- A variable's own years -----------------------------------------------------------------------

def test_a_variable_is_read_over_its_own_years(site_atlas):
    v = entry(site_atlas, "SWC@0.05")
    assert (v["first_year"], v["last_year"]) == (2013, 2021)
    before = [row["SWC@0.05"] for row in site_atlas.payload["months"] if row["y"] < 2013]
    # Outside its years the variable has no coverage figure at all, rather than a coverage of zero.
    assert all(rec["v"] is None and rec["meas"] is None and rec["avail"] is None
               for rec in before)
    year = next(row for row in site_atlas.payload["years"] if row["y"] == 2013)
    assert year["SWC@0.05"]["avail"] == 100


def test_years_outside_the_file_are_refused(site_path):
    with pytest.raises(ValueError, match="outside the years"):
        fa.Atlas(site_path, {"TA": dict(column="TA_F", first_year=2030)}, quiet=True)


# -- A fill legend and measured codes -------------------------------------------------------------

def test_a_fill_legend_names_the_levels_in_the_sites_words(site_atlas):
    fill = entry(site_atlas, "TA")["fill"]
    assert fill["convention"] == "legend"
    assert fill["levels"] == ["linear interpolation", "reconstructed from a neighbour"]
    assert fill["short"] == ["interpolated", "reconstructed"]
    assert "0 measured" in fill["note"] and fill["note"].count("0 measured") == 1


def test_several_codes_can_mean_measured(site_atlas):
    fill = entry(site_atlas, "TS@0.1")["fill"]
    # Only the code a value carries is a level: "no value" is a code no value carries.
    assert fill["levels"] == ["modelled from other depths"]
    shares = [row["TS@0.1"]["meas"] for row in site_atlas.payload["years"]]
    assert all(85 <= s <= 95 for s in shares)


def test_a_code_the_legend_does_not_describe_stops_the_build(site_path):
    legend = {0: "measured", 4: "interpolated"}
    with pytest.raises(ValueError, match=r"code\(s\) 5.*fill legend"):
        fa.Atlas(site_path, {"TA": dict(column="TA_SITE", qc="TA_SITE_FLAG", qc_legend=legend)},
                 quiet=True)
    with pytest.raises(ValueError, match=r"code\(s\) 2.*source legend"):
        fa.Atlas(site_path, {"TA": dict(column="TA_SITE", source=dict(
            column="TA_SITE_SOURCE", legend={0: "new", 1: "old"}))}, quiet=True)


def test_a_legend_accepts_every_form_it_is_documented_in():
    found = varreg.legend_entries({"0": ["long", "short"], 1: "both", 2: {"long": "l"}})
    assert found == {0: ("long", "short"), 1: ("both", "both"), 2: ("l", "l")}
    with pytest.raises(ValueError):
        varreg.legend_entries({"x": "label"})


# -- The source flag ------------------------------------------------------------------------------

def test_the_source_is_shared_out_per_year_by_every_legend_code(site_atlas):
    src = entry(site_atlas, "TA")["source"]
    assert src["codes"] == [0, 1, 2] and src["short"] == ["new", "old", "change"]
    assert src["reference_from"] == "2015-01-08"
    assert all(abs(sum(row) - 100) < 0.5 for row in src["shares"])
    assert src["shares"][0] == [0.0, 100.0, 0.0]
    assert src["shares"][5][2] > 0          # the week of the change has its own code


def test_a_source_without_a_legend_is_described_by_its_codes(site_atlas):
    src = entry(site_atlas, "SWC")["source"]
    assert src["codes"] == [1, 2] and src["long"] == ["code 1", "code 2"]
    assert src["given"] is False


def test_each_span_states_its_source(site_atlas):
    month = next(row for row in site_atlas.payload["months"] if (row["y"], row["m"]) == (2015, 1))
    assert month["TA"]["src"][0] + month["TA"]["src"][2] == 100
    assert site_atlas.payload["meta"]["provenance"]["columns"]["TA"]["source"] == "TA_SITE_SOURCE"


# -- A corrected series and its twin --------------------------------------------------------------

def test_the_correction_is_read_back_out_of_the_file(site_atlas):
    c = entry(site_atlas, "TA")["correction"]
    assert c["column"] == "TA_SITE_RAW"
    assert c["offset"] == pytest.approx(1.3)
    assert c["reference_from"] == "2015-01-08"
    old = next(e for e in c["eras"] if e["code"] == 1)
    new = next(e for e in c["eras"] if e["code"] == 0)
    assert old["offset"] == pytest.approx(1.3) and old["distinct"] == 1
    assert new["max"] <= 0 and new["offset"] is None
    assert c["note"].startswith("Raised by +1.3000 °C before 8 Jan 2015, cooled by up to 0.")
    assert len(c["yearly"]) == 12


def test_a_site_check_of_its_correction_runs_and_may_stop_the_build(site_path):
    seen = {}

    def check(delta, source):
        seen["n"] = len(delta)
        assert (delta[source == 0] <= 0).all(), "the new era is warmed somewhere"

    fa.Atlas(site_path, {"TA": dict(column="TA_SITE", raw="TA_SITE_RAW", checks=check,
                                    source="TA_SITE_SOURCE")}, quiet=True, hourly=False)
    assert seen["n"] > 0

    def failing(delta, source):
        raise AssertionError("not a constant")

    with pytest.raises(ValueError, match="TA: the correction check failed: not a constant"):
        fa.Atlas(site_path, {"TA": dict(column="TA_SITE", raw="TA_SITE_RAW", checks=failing)},
                 quiet=True, hourly=False)


def test_a_note_fills_only_the_placeholders_it_knows():
    note = compare.fill_note("{offset} in {units}, {other} and {break_ts}", "°C",
                             offset="+1.0 °C")
    assert note == "+1.0 °C in °C, {other} and "


# -- A reference station --------------------------------------------------------------------------

def test_the_residual_against_a_reference_is_what_was_built_into_it(site_atlas):
    ref = site_atlas.payload["reference"]
    assert ref["station"] == "Syn reference" and ref["min_overlap"] == 10_000
    ta = ref["vars"]["TA"]
    assert ta["mean"] == pytest.approx(0.5, abs=0.02)
    assert [s["key"] for s in ta["series"]] == ["night", "day"]
    assert ta["break_year"] == 2015
    assert [s["key"] for s in ta["steps"]] == ["all", "night", "day"]
    assert all(abs(s["step"]) < 0.05 for s in ta["steps"])
    # A station published in hPa beside a product in kPa, brought onto it by its factor.
    assert ref["vars"]["PA"]["mean"] == pytest.approx(0.0, abs=1e-6)
    assert ref["vars"]["PA"]["split"] is False and "steps" not in ref["vars"]["PA"]


def test_a_comparison_on_too_few_half_hours_is_withheld(site_path, reference_path):
    # One year, of which only the reconstructed three per cent counts as measured.
    atlas = fa.Atlas(site_path, {"TA": dict(column="TA_SITE", first_year=2021, qc="TA_SITE_FLAG",
                                            measured_codes=[5], reference=dict(column="TA_REF"))},
                     quiet=True, hourly=False, reference=dict(file=reference_path))
    found = atlas.payload["reference"]["vars"]["TA"]
    assert "fewer than the 10,000" in found["withheld"] and "series" not in found


def test_a_reference_is_checked_before_the_file_is_read(site_path, reference_path):
    with pytest.raises(ValueError, match="no reference station file"):
        fa.Atlas(site_path, {"TA": dict(column="TA_F", reference="TA_REF")}, quiet=True)
    with pytest.raises(ValueError, match="latitude, longitude and UTC offset"):
        fa.Atlas(site_path, {"TA": dict(column="TA_F", reference=dict(column="TA_REF",
                                                                      split=True))},
                 reference=dict(file=reference_path), quiet=True)
    with pytest.raises(ValueError, match="names a reference column to compare"):
        fa.Atlas(site_path, {"TA": "TA_F"}, reference=dict(file=reference_path), quiet=True)


def test_night_is_where_the_sun_is_below_the_horizon():
    starts = pd.DatetimeIndex(["2020-06-21 00:00", "2020-06-21 12:00", "2020-12-21 07:30",
                               "2020-12-21 08:30"])
    night = compare.solar_night(starts, lat=47.5, lon=8.4, utc_offset=1)
    assert list(night) == [True, False, True, False]


# -- Notes ----------------------------------------------------------------------------------------

def test_notes_carry_their_unit_and_a_lone_correction_note_joins_them(site_path):
    atlas = fa.Atlas(site_path, {"TA": dict(column="TA_F", notes="In {units}.",
                                            correction_note="Corrected by {offset}.")},
                     quiet=True, hourly=False)
    assert entry(atlas, "TA")["notes"] == ["In °C.", "Corrected by ."]


# -- The year-by-year record ----------------------------------------------------------------------

def test_the_record_layer_states_each_year(site_atlas):
    rec = site_atlas.payload["var_record"]["vars"]
    ta = rec["TA"]
    assert ta["basis"] == "half-hourly values" and ta["units"] == "°C"
    assert all(a <= b <= c <= d <= e for a, b, c, d, e in
               zip(ta["q05"], ta["q25"], ta["q50"], ta["q75"], ta["q95"]))
    assert ta["rec_high"][0] is None and all(isinstance(x, int) for x in ta["rec_high"][1:])
    assert ta["inside"]["ok"] is True
    assert len(ta["clim_lo"]) == 12
    # The soil depth that begins in the fourth year has no gap, and no records, before it.
    swc = rec["SWC@0.05"]
    assert swc["gap_h"][:3] == [None, None, None]
    assert swc["rec_high"][:4] == [None, None, None, None]


def test_the_record_layer_follows_the_page_on_totals(flux_atlas):
    rec = flux_atlas.payload["var_record"]["vars"]
    assert rec["NEE"]["basis"] == "half-hourly values" and rec["NEE"]["rate"] is True
    assert rec["NEE"]["units"] == "µmol m⁻² s⁻¹"
    assert rec["PREC"]["basis"] == "half-hours above zero"
    assert rec["PREC"]["rec_low"] is None


# -- The command line -----------------------------------------------------------------------------

def test_the_command_line_names_every_setting(site_path, reference_path, tmp_path):
    legends = tmp_path / "legends.json"
    legends.write_text(json.dumps({
        "TA": {"source": {str(k): list(v) for k, v in SOURCE_LEGEND.items()},
               "qc": {str(k): list(v) for k, v in FILL_LEGEND.items()}}}), encoding="utf-8")
    out = tmp_path / "site.html"
    code = cli.main([str(site_path), "-o", str(out), "-q", "--no-hourly",
                     "--var", "TA=TA_SITE", "--qc", "TA=TA_SITE_FLAG",
                     "--source", "TA=TA_SITE_SOURCE", "--source-ref", "TA=0",
                     "--legends", str(legends), "--raw", "TA=TA_SITE_RAW",
                     "--var", "SWC@0.3=SWC_30", "--var", "SWC@0.05=SWC_5",
                     "--years", "SWC@0.05=2013:", "--primary", "SWC=SWC@0.3",
                     "--var", "TS@0.1=TS_10", "--qc", "TS@0.1=TS_10_METHOD",
                     "--measured", "TS@0.1=1,2", "--note", "TA=A note in {units}.",
                     "--reference", str(reference_path), "--ref", "TA=TA_REF",
                     "--ref-split", "TA", "--ref-shift", "-15", "--ref-station", "Syn",
                     "--lat", "47.5", "--lon", "8.4", "--utc-offset", "1"])
    assert code == 0 and out.exists()
    html = out.read_text(encoding="utf-8")
    payload = json.loads(re.search(r'<script id="payload" type="application/json">(.*?)</script>',
                                   html, re.S).group(1))
    ta = next(v for v in payload["variables"] if v["key"] == "TA")
    assert ta["source"]["reference_from"] == "2015-01-08"
    assert ta["notes"] == ["A note in \u00b0C."] and "correction" in ta
    assert payload["reference"]["vars"]["TA"]["split"] is True
    assert payload["meta"]["primary"] == {"SWC": "SWC@0.3"}


def test_a_setting_for_a_variable_outside_the_selection_is_refused(site_path, tmp_path):
    with pytest.raises(SystemExit, match="not in the selection"):
        cli.main([str(site_path), "-o", str(tmp_path / "x.html"), "--vars", "TA",
                  "--raw", "PA=PA_F"])
