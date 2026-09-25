"""Net radiation, the soil heat flux, and the two ratios of the surface energy balance.

A FULLSET file publishes the four radiation components and no net radiation, so the closure ratio
can only be formed from the file most users arrive with if net radiation is computed from them.
What has to hold is that the computation is exact, that it is visible - the page must say the figure
was computed and from what - and that a record counts as measured only where every component was.

The two ratios then explode where their denominators near zero, so the other half of this module is
the rule that withholds them: which spans form a ratio, which do not, and that the page offers a
ratio only where the build carries every term it needs.
"""

from __future__ import annotations

import numpy as np
import pytest

from conftest import add_fluxes, add_fullset_extras, synthetic_frame, to_fluxnet_csv
import fluxatlas as fa
from fluxatlas import build, io, variables as varreg

ENERGY = ["H", "LE", "NETRAD", "G"]
FORMULA = "computed: SW_IN_F − SW_OUT + LW_IN_F − LW_OUT"


@pytest.fixture(scope="module")
def energy_frame():
    return add_fullset_extras(add_fluxes(synthetic_frame()))


@pytest.fixture(scope="module")
def energy_path(tmp_path_factory, energy_frame):
    path = tmp_path_factory.mktemp("energy") / "synthetic_energy_HH.parquet"
    energy_frame.to_parquet(path)
    return path


@pytest.fixture(scope="module")
def energy_atlas(energy_path):
    return fa.Atlas(energy_path, ENERGY, site="XX-Syn", hourly=False, quiet=True)


# -- Net radiation from its components ----------------------------------------------------------

def test_net_radiation_is_computed_where_the_file_carries_only_its_components(energy_frame):
    assert "NETRAD" not in energy_frame.columns
    found = io.available(energy_frame)
    assert found["NETRAD"]["column"] == FORMULA
    assert found["NETRAD"]["qc"] == "SW_IN_F_QC & LW_IN_F_QC"


def test_the_computed_series_is_the_sum_of_its_components(energy_path, energy_frame):
    loaded = io.read_fluxnet(energy_path, ["NETRAD"], quiet=True)
    got = loaded["NETRAD"]["series"]
    f = energy_frame
    want = (f["SW_IN_F"] - f["SW_OUT"] + f["LW_IN_F"] - f["LW_OUT"])
    want.index = want.index.floor("30min")
    want = want.reindex(got.index)
    assert got.notna().equals(want.notna())
    assert np.allclose(got.dropna(), want.dropna())


def test_the_computed_series_is_named_as_computed_on_the_page(energy_atlas):
    """The tile prints the column in its corner; a computed figure must not read as a read one."""
    entry = next(v for v in energy_atlas.payload["variables"] if v["key"] == "NETRAD")
    assert entry["column"] == FORMULA
    assert entry["column"].startswith("computed")
    assert "computed from the four radiation components" in entry["about"]


def test_a_record_is_measured_only_where_every_component_was(tmp_path):
    frame = add_fullset_extras(synthetic_frame(years=1))
    frame["SW_IN_F_QC"] = 0
    frame["LW_IN_F_QC"] = 0
    frame.iloc[:100, frame.columns.get_loc("SW_IN_F_QC")] = 1       # shortwave filled
    frame.iloc[100:150, frame.columns.get_loc("LW_IN_F_QC")] = 2    # longwave filled
    frame.iloc[150:170, frame.columns.get_loc("LW_OUT")] = np.nan  # outgoing longwave missing
    path = tmp_path / "flags.parquet"
    frame.to_parquet(path)

    loaded = io.read_fluxnet(path, ["NETRAD"], quiet=True)
    measured = loaded["NETRAD"]["measured"]
    series = loaded["NETRAD"]["series"]
    assert not measured.iloc[:170].any()
    assert series.iloc[:150].notna().all()          # filled components still give a value
    assert series.iloc[150:170].isna().all()        # a missing component gives none
    assert measured.iloc[170:].all()


def test_a_csv_with_missing_components_reads_them_as_missing(tmp_path):
    """`-9999` in any one component must leave the sum missing, not subtract 9999 from it."""
    frame = add_fullset_extras(synthetic_frame(years=1))
    frame.iloc[10:20, frame.columns.get_loc("SW_OUT")] = np.nan
    path = to_fluxnet_csv(frame, tmp_path / "FLX_XX-Syn_FULLSET_HH_2010-2010.csv")
    series = io.read_fluxnet(path, ["NETRAD"], quiet=True)["NETRAD"]["series"]
    assert series.iloc[10:20].isna().all()
    assert series.min() > -500


def test_a_net_radiation_column_of_the_files_own_is_preferred(energy_frame):
    own = energy_frame.copy()
    own["NETRAD"] = 1.0
    found = io.available(own)
    assert found["NETRAD"]["column"] == "NETRAD"
    assert "components" not in found["NETRAD"]


def test_three_components_are_not_a_net_radiation(energy_frame):
    missing = energy_frame.drop(columns=["LW_OUT"])
    assert "NETRAD" not in io.available(missing)
    with pytest.raises(KeyError, match=r"or all of its components: .*LW_OUT"):
        io.resolve(missing, ["NETRAD"])


def test_only_the_components_are_read_from_the_file(energy_path, monkeypatch):
    """The projected read asks for real columns: a formula passed as a column name would fail it."""
    asked = {}
    real = io._read_frame

    def spy(path, usecols=None):
        asked["cols"] = list(usecols)
        return real(path, usecols=usecols)

    monkeypatch.setattr(io, "_read_frame", spy)
    io.read_fluxnet(energy_path, ["NETRAD"], quiet=True)
    assert {"SW_IN_F", "SW_OUT", "LW_IN_F", "LW_OUT", "SW_IN_F_QC", "LW_IN_F_QC"} <= set(
        asked["cols"])
    assert FORMULA not in asked["cols"]


# -- The closure ratio --------------------------------------------------------------------------

def _metric(atlas, key):
    return next((m for m in atlas.payload["metrics"] if m["key"] == key), None)


def test_closure_is_offered_only_where_all_four_terms_are_in_the_build(energy_path, energy_atlas):
    assert _metric(energy_atlas, "ebr") is not None
    without_g = fa.Atlas(energy_path, ["H", "LE", "NETRAD"], site="XX-Syn", hourly=False,
                         quiet=True)
    assert _metric(without_g, "ebr") is None
    assert all("ebr" not in row["x"] for row in without_g.payload["months"])


def monthly_means(atlas):
    """The unrounded monthly mean of each variable, from the series the atlas was built on."""
    return {key: d["series"].resample("MS").mean() for key, d in atlas.loaded.items()}


def test_closure_is_the_turbulent_fluxes_over_the_available_energy(energy_atlas):
    months = energy_atlas.payload["months"]
    means = monthly_means(energy_atlas)
    formed = [row for row in months if row["x"].get("ebr") is not None]
    assert formed
    for row in formed:
        at = f"{row['y']}-{row['m']:02d}-01"
        h, le, rn, g = (means[k][at] for k in ENERGY)
        # The page carries the ratio to one decimal.
        assert row["x"]["ebr"] == pytest.approx(100 * (h + le) / (rn - g), abs=0.051)
    # The synthetic record closes to about 90 % in summer.
    july = [row["x"]["ebr"] for row in formed if row["m"] == 7]
    assert 80 < np.median(july) < 100


def test_closure_is_withheld_where_the_available_energy_is_small(energy_atlas):
    means = monthly_means(energy_atlas)
    for row in energy_atlas.payload["months"]:
        at = f"{row['y']}-{row['m']:02d}-01"
        if means["NETRAD"][at] - means["G"][at] < build.CLOSURE_MIN_ENERGY:
            assert row["x"]["ebr"] is None, row
    # The synthetic winters fall below the threshold, so the rule is exercised.
    assert any(row["x"]["ebr"] is None and row["m"] == 1 for row in energy_atlas.payload["months"])


def test_closure_is_withheld_where_a_term_covers_too_little_of_the_span(energy_atlas):
    """July of the sixth year has no outgoing shortwave, so no net radiation at any energy."""
    row = next(r for r in energy_atlas.payload["months"] if r["y"] == 2015 and r["m"] == 7)
    assert row["NETRAD"]["avail"] < varreg.coverage("NETRAD").normal
    assert row["x"]["ebr"] is None
    others = [r["x"]["ebr"] for r in energy_atlas.payload["months"]
              if r["m"] == 7 and r["y"] != 2015]
    assert all(v is not None for v in others)


def test_a_term_present_for_part_of_a_span_does_not_form_a_ratio(tmp_path):
    """Net radiation over the last third of July set against the fluxes over all of it is not a
    ratio of one period, so a term under its normal's coverage withholds the span."""
    frame = add_fullset_extras(add_fluxes(synthetic_frame(years=1)))
    gap = (frame.index.month == 7) & (frame.index.day <= 20)
    frame.loc[gap, "SW_OUT"] = np.nan
    path = tmp_path / "partial.parquet"
    frame.to_parquet(path)
    atlas = fa.Atlas(path, ENERGY, site="XX-Syn", hourly=False, quiet=True)
    by_month = {row["m"]: row for row in atlas.payload["months"]}
    assert by_month[7]["NETRAD"]["v"] is not None
    assert by_month[7]["NETRAD"]["avail"] < varreg.coverage("NETRAD").normal
    assert by_month[7]["x"]["ebr"] is None
    assert by_month[6]["x"]["ebr"] is not None and by_month[8]["x"]["ebr"] is not None


def test_the_year_tile_carries_the_ratio_of_the_years_own_means(energy_atlas):
    year = energy_atlas.payload["years"][0]
    h, le, rn, g = (energy_atlas.loaded[k]["series"].loc[str(year["y"])].mean() for k in ENERGY)
    assert year["x"]["ebr"] == pytest.approx(100 * (h + le) / (rn - g), abs=0.051)


def test_the_closure_threshold_states_itself_on_the_page(energy_atlas):
    about = _metric(energy_atlas, "ebr")["about"]
    assert f"{build.CLOSURE_MIN_ENERGY:.0f} W m⁻²" in about
    assert "(H + LE) / (NETRAD − G)" in about


# -- The evaporative fraction -------------------------------------------------------------------

def test_the_evaporative_fraction_needs_only_the_two_turbulent_fluxes(energy_path):
    atlas = fa.Atlas(energy_path, ["H", "LE"], site="XX-Syn", hourly=False, quiet=True)
    assert _metric(atlas, "ef") is not None
    assert _metric(atlas, "ebr") is None
    means = monthly_means(atlas)
    for row in atlas.payload["months"]:
        if row["x"]["ef"] is None:
            continue
        at = f"{row['y']}-{row['m']:02d}-01"
        h, le = means["H"][at], means["LE"][at]
        assert row["x"]["ef"] == pytest.approx(100 * le / (h + le), abs=0.051)


def test_a_build_without_both_fluxes_offers_no_evaporative_fraction(energy_path):
    atlas = fa.Atlas(energy_path, ["LE"], site="XX-Syn", hourly=False, quiet=True)
    assert _metric(atlas, "ef") is None


def test_the_evaporative_fraction_is_withheld_below_its_threshold(energy_path, monkeypatch):
    """Raised past anything the record reaches, the threshold withholds every span, and a metric
    with nothing to show is not offered."""
    monkeypatch.setattr(build, "EF_MIN_ENERGY", 1e6)
    atlas = fa.Atlas(energy_path, ["H", "LE"], site="XX-Syn", hourly=False, quiet=True)
    assert all(row["x"]["ef"] is None for row in atlas.payload["months"])
    assert _metric(atlas, "ef") is None


# -- Each alone ----------------------------------------------------------------------------------

@pytest.mark.parametrize("key", ["NETRAD", "G"])
def test_each_energy_term_builds_a_page_on_its_own(energy_path, key, tmp_path):
    atlas = fa.Atlas(energy_path, [key], site="XX-Syn", hourly=False, quiet=True)
    assert [m["key"] for m in atlas.payload["metrics"]] == [key]
    assert atlas.write(tmp_path / f"{key}.html", quiet=True).stat().st_size > 10_000
