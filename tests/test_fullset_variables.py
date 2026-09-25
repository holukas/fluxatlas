"""The rest of a FULLSET file's meteorology: soil temperature, wind, pressure, longwave, PPFD, u*.

Each is a registry entry and nothing more, so what can go wrong is what goes wrong with any entry:
a candidate name the file does not use, a unit factor off by an order of magnitude, a limit set
inside the span a real record reaches, or a variable that reads correctly and then breaks the page
when it is the only thing selected. The first three are checked against the names, units and
spans of the CH-Oe2 FULLSET file the flux work is developed on, written out here so the checks run
without it; the last by building each variable alone.
"""

from __future__ import annotations

import pytest

from conftest import add_fluxes, add_fullset_extras, synthetic_frame
import fluxatlas as fa
from fluxatlas import io, variables as varreg

NEW = ("TS", "WS", "PA", "LW_IN", "PPFD_IN", "USTAR")

# The relevant part of the CH-Oe2 FULLSET header, verbatim.
OE2_HEADER = [
    "TIMESTAMP_START", "TIMESTAMP_END",
    "SW_IN_POT", "SW_IN_F_MDS", "SW_IN_F_MDS_QC", "SW_IN_ERA", "SW_IN_F", "SW_IN_F_QC",
    "LW_IN_F_MDS", "LW_IN_F_MDS_QC", "LW_IN_ERA", "LW_IN_F", "LW_IN_F_QC", "LW_IN_JSB",
    "LW_IN_JSB_QC", "LW_IN_JSB_ERA", "LW_IN_JSB_F", "LW_IN_JSB_F_QC", "PA", "PA_ERA", "PA_F",
    "PA_F_QC", "WS", "WS_ERA", "WS_F", "WS_F_QC", "USTAR", "PPFD_IN", "PPFD_DIF", "SW_OUT",
    "LW_OUT", "TS_F_MDS_1", "TS_F_MDS_2", "TS_F_MDS_1_QC", "TS_F_MDS_2_QC", "SWC_F_MDS_1",
    "SWC_F_MDS_1_QC", "G_F_MDS", "G_F_MDS_QC", "LE_F_MDS", "LE_F_MDS_QC", "H_F_MDS",
    "H_F_MDS_QC",
]

# What each variable resolves to on that header, and the span the resolved column reaches over
# the whole record after conversion - the numbers the limits were set outside of.
OE2 = {
    "TS": ("TS_F_MDS_1", "TS_F_MDS_1_QC", -11.535, 42.797),
    "WS": ("WS_F", "WS_F_QC", 0.002, 14.459),
    "PA": ("PA_F", "PA_F_QC", 92.349, 98.699),
    "LW_IN": ("LW_IN_F", "LW_IN_F_QC", 157.347, 470.525),
    "PPFD_IN": ("PPFD_IN", None, -14.248, 2332.340),
    "USTAR": ("USTAR", None, 0.005, 3.921),
    "G": ("G_F_MDS", "G_F_MDS_QC", -250.600, 217.300),
    "NETRAD": ("computed: SW_IN_F − SW_OUT + LW_IN_F − LW_OUT", "SW_IN_F_QC & LW_IN_F_QC",
               -248.960, 889.790),
}


@pytest.fixture(scope="module")
def extras_path(tmp_path_factory):
    frame = add_fullset_extras(add_fluxes(synthetic_frame()))
    path = tmp_path_factory.mktemp("extras") / "synthetic_extras_HH.parquet"
    frame.to_parquet(path)
    return path


# -- Names, units and limits against the real file ------------------------------------------------

@pytest.mark.parametrize("key", sorted(OE2))
def test_each_variable_resolves_to_the_column_a_fullset_file_carries(key):
    column, qc, _, _ = OE2[key]
    found = io.available(OE2_HEADER)
    assert found[key]["column"] == column
    assert found[key]["qc"] == qc


def test_modelled_longwave_is_never_taken_for_the_radiometer():
    """`LW_IN_JSB` is computed from temperature and humidity; standing in for a measured `LW_IN`
    without saying so would put a model on the page under a measurement's name."""
    header = [c for c in OE2_HEADER if not c.startswith(("LW_IN_F", "LW_IN_ERA"))]
    assert "LW_IN" not in io.available(header)


@pytest.mark.parametrize("key", sorted(OE2))
def test_the_limits_sit_outside_the_span_the_real_record_reaches(key):
    """A limit is a unit check, not a filter: inside the real span, it would refuse a real file."""
    _, _, low, high = OE2[key]
    lo, hi = varreg.make(key).limits
    assert lo < low and high < hi


def test_pressure_in_hectopascals_is_refused_as_a_unit_error(tmp_path):
    frame = add_fullset_extras(synthetic_frame(years=1))
    frame["PA_F"] = frame["PA_F"] * 10
    path = tmp_path / "hpa.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match=r"PA: PA_F spans .* outside the plausible range"):
        io.read_fluxnet(path, ["PA"], quiet=True)


# -- Friction velocity -----------------------------------------------------------------------------

def test_friction_velocity_sits_with_the_fluxes_but_warns_at_the_meteorological_line():
    """It is measured by the sonic with the fluxes, so it is grouped with them; it is neither
    gap-filled nor u*-filtered, so the flux warning line - set low because half of every flux
    record is rejected by design - does not apply to it."""
    assert varreg.family("USTAR") == varreg.FLUX
    cov = varreg.coverage("USTAR")
    assert cov.warn == varreg.COVERAGE_DEFAULT.warn
    assert cov.normal < varreg.COVERAGE_DEFAULT.normal


def test_friction_velocity_gaps_are_missing_not_modelled(extras_path):
    loaded = io.read_fluxnet(extras_path, ["USTAR"], quiet=True)
    assert loaded["USTAR"]["v"].qc_column is None
    series, measured = loaded["USTAR"]["series"], loaded["USTAR"]["measured"]
    assert (measured == series.notna()).all()
    assert 0.8 < measured.mean() < 0.9


def test_a_month_of_friction_velocity_at_85_percent_still_carries_a_normal(extras_path):
    """At the meteorological 90 % gate a variable present in 85 % of records carries no normal in
    most months; at its own gate it does, and the one month of outage does not."""
    atlas = fa.Atlas(extras_path, ["USTAR"], site="XX-Syn", hourly=False, quiet=True)
    months = atlas.payload["months"]
    ranked = [row for row in months if row["USTAR"]["r"] is not None]
    assert len(ranked) >= len(months) - 1
    outage = next(row for row in months if row["y"] == 2012 and row["m"] == 3)
    assert outage["USTAR"]["v"] is None


# -- Each one alone ---------------------------------------------------------------------------

@pytest.mark.parametrize("key", NEW)
def test_each_new_variable_builds_a_page_on_its_own(extras_path, key, tmp_path):
    atlas = fa.Atlas(extras_path, [key], site="XX-Syn", hourly=False, quiet=True)
    assert atlas.variables == [key]
    # A page needs at least one metric to colour its grid by, so a variable that is to work alone
    # has to bring its own.
    assert [m["key"] for m in atlas.payload["metrics"]] == [key]
    own = next(v for v in atlas.payload["variables"] if v["key"] == key)
    assert own["metric"] == key
    page = atlas.write(tmp_path / f"{key}.html", quiet=True)
    assert page.stat().st_size > 10_000

