"""The turbulent fluxes: how they resolve, what unit they arrive in, and what gates their statistics.

The four things worth a test here are the four that would be silently wrong rather than loudly
broken. A unit conversion applied to one of the three carbon terms and not the others still
produces a page. A `GPP` that resolved to the daytime product while `RECO` resolved to the
nighttime one still produces a page. A coverage threshold set where meteorology's is still produces
a page - one whose entire flux half is blank, which is the failure this module exists to catch.
"""

from __future__ import annotations

import re

import numpy as np
import pytest

from conftest import add_fluxes, synthetic_frame, to_fluxnet_csv
from fluxatlas import io, variables as varreg


# -- Resolution ----------------------------------------------------------------------------------

def test_the_registry_finds_the_fullset_flux_columns(flux_parquet_path):
    found = io.available(flux_parquet_path)
    assert found["NEE"]["column"] == "NEE_VUT_REF"
    assert found["GPP"]["column"] == "GPP_NT_VUT_REF"
    assert found["RECO"]["column"] == "RECO_NT_VUT_REF"
    assert found["LE"]["column"] == "LE_F_MDS"
    assert found["H"]["column"] == "H_F_MDS"


def test_the_variable_ustar_reference_is_preferred_over_the_constant_one(flux_frame):
    """VUT_REF recomputes the threshold per year, which is the one a record of decades wants."""
    both = flux_frame.copy()
    both["NEE_CUT_REF"] = both["NEE_VUT_REF"]
    assert io.available(both)["NEE"]["column"] == "NEE_VUT_REF"
    # And with only the constant-threshold product present, that is what it falls back to.
    cut_only = both.drop(columns=["NEE_VUT_REF"])
    assert io.available(cut_only)["NEE"]["column"] == "NEE_CUT_REF"


def test_nighttime_partitioning_resolves_before_daytime(flux_frame):
    both = flux_frame.copy()
    both["GPP_DT_VUT_REF"] = both["GPP_NT_VUT_REF"]
    assert io.available(both)["GPP"]["column"] == "GPP_NT_VUT_REF"
    dt_only = both.drop(columns=["GPP_NT_VUT_REF"])
    assert io.available(dt_only)["GPP"]["column"] == "GPP_DT_VUT_REF"


def test_gpp_and_reco_take_their_quality_flag_from_the_net_flux(flux_parquet_path):
    """Neither is measured; both are partitioned out of a net flux whose QC is the honest one."""
    loaded = io.read_fluxnet(flux_parquet_path, ["NEE", "GPP", "RECO"], quiet=True)
    for key in ("NEE", "GPP", "RECO"):
        assert loaded[key]["v"].qc_column == "NEE_VUT_REF_QC"
    # So all three report exactly the same measured share.
    shares = {key: loaded[key]["measured"].mean() for key in ("NEE", "GPP", "RECO")}
    assert len(set(shares.values())) == 1


# -- Units ---------------------------------------------------------------------------------------

def test_carbon_arrives_as_grams_of_carbon_per_half_hour(flux_parquet_path, flux_frame):
    loaded = io.read_fluxnet(flux_parquet_path, ["NEE"], quiet=True)
    v = loaded["NEE"]["v"]
    assert v.units == "g C m⁻²"
    assert v.agg == "sum"
    # 1e-6 mol * 1800 s * 12.011 g/mol.
    assert v.factor == pytest.approx(0.0216198, rel=1e-4)

    raw = flux_frame["NEE_VUT_REF"]
    got = loaded["NEE"]["series"].reindex(raw.index)
    assert got.dropna().to_numpy() == pytest.approx(
        (raw * varreg.UMOL_TO_GC).reindex(got.dropna().index).to_numpy())


def test_the_partitioning_identity_survives_the_unit_conversion(flux_parquet_path):
    """NEE = RECO - GPP holds in µmol, so it must still hold in g C - one factor, applied once."""
    loaded = io.read_fluxnet(flux_parquet_path, ["NEE", "GPP", "RECO"], quiet=True)
    nee = loaded["NEE"]["series"]
    residual = (nee - (loaded["RECO"]["series"] - loaded["GPP"]["series"])).dropna()
    # The synthetic series are rounded to three decimals in µmol before conversion, so the
    # identity holds to the rounding rather than exactly.
    assert np.abs(residual).max() < 1e-4


def test_energy_fluxes_stay_in_watts_and_average(flux_parquet_path):
    loaded = io.read_fluxnet(flux_parquet_path, ["LE", "H"], quiet=True)
    for key in ("LE", "H"):
        assert loaded[key]["v"].units == "W m⁻²"
        assert loaded[key]["v"].factor == 1.0
        assert loaded[key]["v"].agg == "mean"


def test_a_flux_in_the_wrong_unit_fails_the_read_naming_the_column(tmp_path):
    """The plausible-range check is what catches a column left in µmol or read as something else."""
    frame = add_fluxes(synthetic_frame(years=2))
    # A hundredfold error, which is roughly what leaving out the molar conversion would do.
    frame["NEE_VUT_REF"] = frame["NEE_VUT_REF"] * 500
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="NEE_VUT_REF"):
        io.read_fluxnet(path, ["NEE"], quiet=True)


# -- Coverage ------------------------------------------------------------------------------------

def test_every_variable_is_gated_the_same_and_warned_about_differently():
    """One rule gates: is the span covered. What differs per variable is only the warning line."""
    assert varreg.coverage("TA") == varreg.COVERAGE_DEFAULT
    assert varreg.coverage("NEE") == varreg.FLUX_COVERAGE
    # The gate is identical, so no variable's statistics are computed on a different rule.
    assert varreg.coverage("NEE").normal == varreg.coverage("TA").normal
    assert varreg.coverage("NEE").badge == varreg.coverage("TA").badge
    # Only the measured share a span is flagged below differs, and a flux is held lower.
    assert varreg.coverage("NEE").warn < varreg.coverage("TA").warn
    # An unknown key is answered conservatively rather than with an error.
    assert varreg.coverage("NOT_A_VARIABLE") == varreg.COVERAGE_DEFAULT


def test_a_flux_record_is_measured_far_below_the_meteorological_threshold(flux_parquet_path):
    """The premise of the separate thresholds: assert the gap structure this is all about."""
    loaded = io.read_fluxnet(flux_parquet_path, ["TA", "NEE"], quiet=True)
    assert loaded["TA"]["measured"].mean() > 0.9
    assert 0.3 < loaded["NEE"]["measured"].mean() < 0.6


def test_every_covered_month_is_ranked_however_much_of_it_was_measured(flux_atlas):
    """The regression this module exists for.

    Gated on measurement, no month of any flux record reaches 90 %, so NEE would get no normal, no
    rank, no anomaly and no badge - and the page would report nothing rather than reporting that it
    found nothing. The gap-filled series is the published product, so every month it covers counts.
    """
    months = flux_atlas.payload["months"]

    # `r` is the rank within the calendar month, `a` the anomaly against its normal.
    ranked = [mo for mo in months if mo.get("NEE") and mo["NEE"].get("r") is not None]
    assert len(ranked) == len(months), "every covered month should be ranked"

    with_anom = [mo for mo in months if mo.get("NEE") and mo["NEE"].get("a") is not None]
    assert len(with_anom) == len(months)

    # Which is what fills the winter columns: every calendar month has a normal, including the ones
    # whose measured share is lowest.
    for m in range(1, 13):
        rows = [mo for mo in months if mo["m"] == m]
        assert all(mo["NEE"]["a"] is not None for mo in rows), f"month {m} has no normal"

    awarded = flux_atlas.badges
    assert awarded["sink_strong"] + awarded["sink_weak"] > 0
    assert awarded["record_sink"] > 0


def test_thinly_measured_months_are_marked_rather_than_withheld(flux_atlas):
    """The measured share gates nothing and flags everything below the line."""
    months = flux_atlas.payload["months"]
    warn = varreg.coverage("NEE").warn
    thin = [mo for mo in months if mo["NEE"]["meas"] < warn]
    for mo in thin:
        # Marked...
        assert any(b["k"] == "sparse" for b in mo["b"]), "a thin month carries no sparse badge"
        # ...and used anyway.
        assert mo["NEE"]["v"] is not None and mo["NEE"]["r"] is not None


def test_the_build_counts_what_leans_on_the_gap_filling(flux_atlas):
    """The warning the page and the console both rest on."""
    thin = flux_atlas.payload["meta"]["thin"]
    assert set(thin) == set(flux_atlas.variables)
    assert thin["NEE"]["warn"] == varreg.FLUX_COVERAGE.warn
    assert thin["TA"]["warn"] == varreg.COVERAGE_DEFAULT.warn
    for key, d in thin.items():
        assert 0 <= d["n"] <= d["n_total"]
        if d["n"]:
            assert d["lowest"] < d["warn"] and d["worst"]


def test_each_variable_ships_the_thresholds_the_page_reads(flux_atlas):
    cov = {v["key"]: v["cov"] for v in flux_atlas.payload["variables"]}
    assert cov["TA"]["warn"] == varreg.COVERAGE_DEFAULT.warn
    assert cov["NEE"]["warn"] == varreg.FLUX_COVERAGE.warn
    # The gate is the same for both, which is the point.
    assert cov["TA"]["normal"] == cov["NEE"]["normal"]


def test_the_warning_line_is_stated_per_variable(flux_atlas, ta_atlas):
    """One number is stated where one applies, and both where the build carries both."""
    text = flux_atlas.payload["meta"]["cov_warn_text"]
    assert "NEE" in text and "20 %" in text and "50 %" in text
    # A meteorology-only build has a single line and says so without qualification.
    assert ta_atlas.payload["meta"]["cov_warn_text"] == "50 %"


# -- What a year is judged on --------------------------------------------------------------------

def test_every_variable_publishes_a_trend_over_the_whole_record(flux_atlas):
    """The regression for the second silence.

    A flux year never reaches 90 % *measured* - u* filtering removes half of every record - so a
    rule asking for one withholds every flux trend at every site. Judged on whether the gap-filled
    product covers the year, which is the basis the annual sums are published on, the whole record
    takes part - for the meteorology as much as for the fluxes.
    """
    n_years = flux_atlas.last_year - flux_atlas.first_year + 1
    trends = {m["key"]: m.get("trend_year") for m in flux_atlas.payload["metrics"]}
    for key in ("NEE", "GPP", "TA"):
        t = trends.get(key)
        assert t is not None and "slope" in t, f"the {key} trend is withheld: {t}"
        assert t["n"] == n_years


def test_the_measured_rule_would_have_withheld_them(flux_atlas):
    """If the two rules agreed, none of this would be doing anything."""
    months = flux_atlas.payload["months"]
    floor = varreg.COVERAGE_DEFAULT.normal
    by_meas = sum(1 for mo in months if mo["NEE"]["meas"] >= floor)
    by_avail = sum(1 for mo in months if mo["NEE"]["avail"] >= floor)
    assert by_meas == 0, "no flux month reaches the measured threshold - that is the whole problem"
    assert by_avail == len(months)


def test_the_warning_actually_prints(flux_parquet_path, capsys):
    """Exercised without `quiet`, because every other test in this suite passes it.

    The reporting path is the half a caller sees first and the half the tests never ran: a missing
    import in it survived a whole green suite and only failed on a real build.
    """
    import fluxatlas as fa
    fa.Atlas(flux_parquet_path, ["TA", "NEE"], site="XX-Syn", hourly=False)
    printed = capsys.readouterr().out
    assert "warning:" in printed and "% measured in" in printed
    assert "gap-filled values are used" in printed


def test_the_page_discloses_what_leans_on_the_gap_filling(flux_atlas):
    """A figure computed on filled records carries more model where less was measured, and says so."""
    thin = flux_atlas.payload["meta"]["thin"]
    assert any(d["n"] for d in thin.values()), "nothing flagged - the disclosure would be empty"
    # Every variable in the build is accounted for, flagged or not.
    assert set(thin) == set(flux_atlas.variables)


# -- Uncertainty ---------------------------------------------------------------------------------
#
# The half-hourly uncertainty a FULLSET file publishes has to become a monthly one, and how depends
# entirely on whether the error is independent between records or one choice held across all of
# them. Getting that wrong is not a rounding difference: on the CH-Oe2 record the two treatments of
# the same u* uncertainty differ by a factor of fourteen at annual scale, in the direction that
# makes the page look far more certain than the data supports.


def test_each_flux_gets_the_components_its_file_publishes(flux_parquet_path):
    loaded = io.read_fluxnet(flux_parquet_path, ["NEE", "GPP", "RECO", "LE", "H"], quiet=True)
    kinds = {k: [(c["kind"], c["label"]) for c in d["uncertainty"]] for k, d in loaded.items()}
    assert kinds["NEE"] == [(varreg.QUADRATURE, "random"), (varreg.ENSEMBLE, "u* threshold")]
    assert kinds["GPP"] == [(varreg.SYSTEMATIC, "u* threshold")]
    assert kinds["LE"] == [(varreg.QUADRATURE, "random")]
    # And each says what its interval covers, so the page never shows one symbol for two claims.
    assert loaded["NEE"]["v"].uncertainty_note == "random and u* threshold"
    assert loaded["LE"]["v"].uncertainty_note == "random"


def test_a_variable_the_file_has_no_uncertainty_for_gets_none(flux_parquet_path):
    loaded = io.read_fluxnet(flux_parquet_path, ["TA"], quiet=True)
    assert loaded["TA"]["uncertainty"] == []
    assert loaded["TA"]["v"].uncertainty_note is None


def test_a_systematic_term_does_not_shrink_with_the_length_of_the_span(flux_atlas):
    """The property the whole design turns on.

    The synthetic u* members are a constant factor off the reference, so the ensemble half-spread
    of a monthly total must be that same factor of the total - not the factor divided by the square
    root of the month's length, which is what treating it as random would give.
    """
    months = [mo for mo in flux_atlas.payload["months"] if isNum_(mo["NEE"]["u"])]
    assert months, "no month carries an interval"
    # Members run 0.90 to 1.10 of the reference, so the half-spread is 0.10 of the monthly total.
    # The random term adds a little in quadrature on top, so the ratio sits just above it.
    ratios = [abs(mo["NEE"]["u"] / mo["NEE"]["v"]) for mo in months if abs(mo["NEE"]["v"]) > 20]
    assert ratios
    assert 0.10 <= np.median(ratios) < 0.16, (
        f"median interval is {np.median(ratios):.3f} of the total; a systematic term held across "
        f"the month should stay at about 0.10, and shrinking suggests it is being put through a "
        f"quadrature that does not apply to it")


def test_the_interval_is_carried_in_the_units_of_the_variable(flux_atlas):
    """An interval in µmol around a figure in g C would say nothing.

    Judged against the record rather than against each month. A single month's interval may exceed
    its own total and be perfectly correct - a month whose uptake and release almost cancel has a
    near-zero net exchange that is still uncertain by as much as any other month - so the test that
    catches a missing conversion is the one against the typical magnitude of the record.
    """
    months = flux_atlas.payload["months"]
    for key in ("NEE", "GPP", "RECO"):
        typical = np.median([abs(mo[key]["v"]) for mo in months if isNum_(mo[key]["v"])])
        intervals = [mo[key]["u"] for mo in months if isNum_(mo[key]["u"])]
        assert intervals, f"{key} carries no interval"
        # Left unconverted the interval would be about 46x too large against a converted total.
        assert np.median(intervals) < typical, (
            f"{key}: median interval {np.median(intervals):.3g} against a typical month of "
            f"{typical:.3g} - the unit conversion looks not to have been applied to it")


def test_an_interval_never_rounds_away_to_zero(flux_atlas):
    """A "± 0" reads as certainty. The payload keeps more decimals than the value it qualifies."""
    for mo in flux_atlas.payload["months"]:
        for key in ("LE", "H"):
            rec = mo.get(key)
            if rec and isNum_(rec["u"]):
                assert rec["u"] > 0


def isNum_(x):
    return x is not None and not (isinstance(x, float) and np.isnan(x))


# -- What the fluxes add to the page -------------------------------------------------------------

def test_the_carbon_metrics_are_offered_only_when_their_variable_is(flux_atlas, full_atlas):
    carbon = {k for k, _ in flux_atlas.metrics} & {"NEE", "NEE_anom", "n_sink", "GPP", "RECO"}
    assert carbon == {"NEE", "NEE_anom", "n_sink", "GPP", "RECO"}
    # And a build without them offers none of them, which is the selection rule the atlas is built on.
    assert not {k for k, _ in full_atlas.metrics} & carbon


def test_monthly_carbon_is_a_total_not_a_mean(flux_atlas):
    """A month reads as the carbon the site gained or lost, which is why `agg` is sum."""
    nee = [mo["NEE"]["v"] for mo in flux_atlas.payload["months"]
           if mo.get("NEE") and mo["NEE"].get("v") is not None]
    # Half-hourly values are fractions of a gram; a summed month is tens to hundreds.
    assert max(abs(v) for v in nee) > 10


def test_sink_days_are_counted(flux_atlas):
    flags = {f["key"] for f in flux_atlas.payload["flags"]}
    assert "sink" in flags
    counts = [mo["c"].get("sink") for mo in flux_atlas.payload["months"] if "c" in mo]
    assert any(c for c in counts if c)


# -- The empty-column hazard ---------------------------------------------------------------------

# -- A build with no air temperature in it -------------------------------------------------------

def test_an_atlas_without_air_temperature_builds_completely(flux_parquet_path):
    """Every selection rule the atlas is built on has to hold for a selection that drops TA.

    Worth its own test because TA is the variable the page's structure leans on - the growing
    season, the frost boundaries and the composite are all taken from it - so a build without it
    exercises paths that no other selection reaches.
    """
    import fluxatlas as fa
    atlas = fa.Atlas(flux_parquet_path, ["NEE", "GPP"], site="XX-Syn", hourly=False, quiet=True)

    assert atlas.variables == ["NEE", "GPP"]
    assert [k for k, _ in atlas.metrics], "a carbon-only build offers no metric at all"
    # The temperature machinery is withheld rather than computed on something else.
    assert not {k for k, _ in atlas.metrics} & {"TA", "TA_anom", "gdd", "dtr", "n_frost"}
    months = atlas.payload["months"]
    assert len(months) == 12 * (atlas.last_year - atlas.first_year + 1)
    assert all("TA" not in mo for mo in months)


def test_the_renderer_never_dereferences_a_fixed_variable_on_a_span(tmp_path):
    """The renderer must not assume a particular variable is in the build.

    `seasonLine` read `se.TA.v` outright, which threw for any selection leaving air temperature
    out - the fluxes on their own, or precipitation on its own. pytest cannot execute the renderer,
    so this asserts the shape that caused it: a span record reached for by a fixed key and
    dereferenced in the same breath. Reading `VARS.TA.units` inside an `if (VARS.TA)` is fine and
    is not what this matches.
    """
    from pathlib import Path
    from fluxatlas import build

    js = (Path(build.__file__).parent / "assets" / "calendar.js").read_text(encoding="utf-8")
    keys = "|".join(varreg.known())
    offenders = re.findall(rf"\b(?:se|mo|rec|child|here)\.(?:{keys})\.\w+", js)
    assert not offenders, (
        f"the renderer dereferences {', '.join(sorted(set(offenders)))} without checking the "
        f"variable is in the build; guard it or read it through the payload's variable list")


def test_a_column_that_is_present_but_never_filled_is_refused(tmp_path):
    """`LE_CORR` and `H_CORR` are `-9999` in every record of a real CH-Oe2 file.

    The header scan cannot see that, so such a column resolves exactly like a real one. Building an
    empty variable from it would put a blank section on the page with nothing to explain it.
    """
    frame = add_fluxes(synthetic_frame(years=2))
    frame["LE_F_MDS"] = np.nan
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="LE_F_MDS.*every one of its"):
        io.read_fluxnet(path, ["LE"], quiet=True)


def test_the_refusal_names_the_columns_worth_trying_instead(tmp_path):
    frame = add_fluxes(synthetic_frame(years=2))
    frame["LE_F_MDS"] = np.nan
    frame["LE_CORR"] = 100.0
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="LE_CORR"):
        io.read_fluxnet(path, ["LE"], quiet=True)
