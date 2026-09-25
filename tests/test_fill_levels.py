"""How a span's gap-filling is described: which quality of fill, not only measured or not.

A FLUXNET quality flag says more than one bit. The page used to keep only whether a record was
measured, so a month filled at good quality and one filled at poor quality read identically, and
the legend written for the other codes was used nowhere - which was as well, since it would have
called the ERA reanalysis in `TA_F_QC` a "medium-quality fill". A code means what its column's
convention says, and these tests hold the page to that.

None of this gates anything. Every statistic is computed on availability whatever the flag says,
and `test_the_fill_levels_describe_and_do_not_gate` holds that line.
"""

from __future__ import annotations

import calendar
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import fluxatlas as fa
from fluxatlas import io as fio
from fluxatlas import variables as varreg
from conftest import add_fluxes, synthetic_frame

FIRST = 2010
YEARS = 3

NODE = shutil.which("node")
TEXT = Path(__file__).parent / "fill_text.mjs"
SMOKE = Path(__file__).parent / "js" / "smoke.mjs"
JSDOM = (Path(__file__).parent / "js" / "node_modules" / "jsdom").is_dir()
needs_jsdom = pytest.mark.skipif(NODE is None or not JSDOM,
                                 reason="node with jsdom is not available; run `npm install` in "
                                        "tests/js")


# -- Data -------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def flagged(tmp_path_factory):
    """Three years with flags in both FLUXNET conventions and one no convention knows.

    `TA_F_QC` is consolidated meteorology (0, 1, 2) with a code 3 it does not document planted in
    March 2011, and nothing but 0 in January 2011. `NEE_VUT_REF_QC` is the MDS grading (0 to 3), as
    `add_fluxes` writes it. `TA_FLAG` is a flag of some other file, with codes of its own.
    """
    frame = add_fluxes(synthetic_frame(years=YEARS))
    rng = np.random.default_rng(7)
    qc = rng.choice([0, 1, 2], len(frame), p=[0.90, 0.04, 0.06])
    idx = frame.index
    qc[(idx.year == 2011) & (idx.month == 1)] = 0
    march = np.flatnonzero((idx.year == 2011) & (idx.month == 3))
    qc[march[:96]] = 3
    frame["TA_F_QC"] = qc
    frame["TA_FLAG"] = np.where(qc == 0, 0, np.where(qc == 1, 7, 9))
    path = tmp_path_factory.mktemp("fill") / "fill_HH.parquet"
    frame.to_parquet(path)
    return frame, path


@pytest.fixture(scope="module")
def atlas(flagged):
    return fa.Atlas(flagged[1], ["TA", "NEE", "PREC"], site="XX-Fil", hourly=False, quiet=True)


@pytest.fixture(scope="module")
def unstated(flagged):
    return fa.Atlas(flagged[1], {"TA": {"column": "TA_F", "qc": "TA_FLAG"}}, site="XX-Fil",
                    hourly=False, quiet=True)


@pytest.fixture(scope="module")
def unflagged(flagged):
    return fa.Atlas(flagged[1], {"TA": {"column": "TA_F", "qc": None}}, site="XX-Fil",
                    hourly=False, quiet=True)


def var(atlas, key):
    return next(v for v in atlas.payload["variables"] if v["key"] == key)


def expected_shares(codes, levels, n_records):
    """Share of the span at each level, from the raw codes, as the payload rounds it."""
    out = [int(round(100 * np.isin(codes, level).sum() / n_records)) for level in levels]
    while out and not out[-1]:
        out.pop()
    return out


# -- The convention follows the column ---------------------------------------------------------

@pytest.mark.parametrize("column, convention", [
    ("TA_F_QC", "QC_CONSOLIDATED"),
    ("SW_IN_F_QC", "QC_CONSOLIDATED"),
    ("VPD_F_QC", "QC_CONSOLIDATED"),
    ("P_F_QC", "QC_CONSOLIDATED"),
    ("TA_F_MDS_QC", "QC_MDS"),
    ("SWC_F_MDS_1_QC", "QC_MDS"),
    ("LE_F_MDS_QC", "QC_MDS"),
    ("NEE_VUT_REF_QC", "QC_MDS"),
    ("NEE_CUT_USTAR50_QC", "QC_MDS"),
    ("NEE_VUT_16_QC", "QC_MDS"),
    # The share of the ensemble that was filled - a fraction, not a code.
    ("NEE_VUT_MEAN_QC", "QC_UNSTATED"),
    ("TA_QC", "QC_UNSTATED"),
    ("TA_FLAG", "QC_UNSTATED"),
])
def test_each_flag_column_is_read_in_its_own_convention(column, convention):
    assert varreg.qc_convention(column) is getattr(varreg, convention)


def test_no_flag_has_no_convention():
    assert varreg.qc_convention(None) is None


def test_a_code_two_is_reanalysis_in_one_column_and_medium_fill_in_another():
    """The mistake the dormant legend would have made: one word for code 2 everywhere."""
    assert varreg.QC_CONSOLIDATED.levels[1].label == "from reanalysis"
    assert varreg.QC_MDS.levels[1].label == "medium-quality fill"


def test_codes_map_onto_levels_by_convention():
    index = pd.RangeIndex(7)
    qc = pd.Series([0, 1, 2, 3, np.nan, 5, 1], index=index, dtype=float)
    values = pd.Series([1.0, 1, 1, 1, 1, 1, np.nan], index=index)
    got = {c.name: fio.fill_levels(qc, values, c).tolist()
           for c in (varreg.QC_MDS, varreg.QC_CONSOLIDATED, varreg.QC_UNSTATED)}
    # 0 measured, 1..n the convention's levels, n+1 undocumented, -1 no value at all.
    assert got["mds"] == [0, 1, 2, 3, 4, 4, -1]
    assert got["consolidated"] == [0, 1, 2, 3, 3, 3, -1]
    assert got["unstated"] == [0, 1, 1, 1, 2, 1, -1]
    assert fio.fill_levels(qc, values, varreg.QC_MDS).dtype == np.int8


# -- The reader --------------------------------------------------------------------------------

def test_the_reader_keeps_the_level_of_every_record(atlas, flagged):
    frame, _ = flagged
    ta, nee = atlas.loaded["TA"], atlas.loaded["NEE"]
    assert ta["fill"].dtype == np.int8
    # One small integer per record, and the measured split read off it.
    assert ta["measured"].equals(ta["fill"] == 0)
    counts = ta["fill"].value_counts().to_dict()
    codes = frame["TA_F_QC"].to_numpy()
    assert counts == {level: int((codes == level).sum()) for level in (0, 1, 2, 3)
                      if (codes == level).any()}
    nee_codes = frame["NEE_VUT_REF_QC"].to_numpy()
    assert nee["fill"].value_counts().to_dict() == {
        level: int((nee_codes == level).sum()) for level in (0, 1, 2, 3)}


def test_each_variable_names_its_levels_in_its_own_convention(atlas):
    ta, nee, prec = var(atlas, "TA"), var(atlas, "NEE"), var(atlas, "PREC")
    assert ta["fill"]["flag"] == "TA_F_QC" and ta["fill"]["convention"] == "consolidated"
    # The planted code 3 is not a level of the consolidated convention and is not given one.
    assert ta["fill"]["levels"] == ["gap-filled", "from reanalysis", varreg.FILL_OTHER]
    assert nee["fill"]["convention"] == "mds"
    assert nee["fill"]["levels"] == ["good-quality fill", "medium-quality fill",
                                     "poor-quality fill"]
    # No undocumented code in the record, so no level for one.
    assert prec["fill"]["levels"] == ["gap-filled", "from reanalysis"]
    assert "reanalysis" in ta["fill"]["note"] and "medium" in nee["fill"]["note"]


# -- The spans ---------------------------------------------------------------------------------

def test_month_season_and_year_shares_count_the_codes(atlas, flagged):
    frame, _ = flagged
    idx = frame.index
    p = atlas.payload
    ta_levels = [[1], [2], [3]]
    nee_levels = [[1], [2], [3]]

    month = next(r for r in p["months"] if r["y"] == 2011 and r["m"] == 3)
    sel = (idx.year == 2011) & (idx.month == 3)
    n = 31 * 48
    assert month["TA"]["f"] == expected_shares(frame.loc[sel, "TA_F_QC"], ta_levels, n)
    assert month["TA"]["f"][2] > 0          # the planted undocumented code
    assert month["NEE"]["f"] == expected_shares(frame.loc[sel, "NEE_VUT_REF_QC"], nee_levels, n)

    # A whole season, against the half-hours it should hold, as the measured share is.
    season = next(r for r in p["seasons"] if r["y"] == 2011 and r["s"] == p["season_defs"][0]["key"])
    sel = np.zeros(len(idx), bool)
    days = 0
    for y, m in season["months"]:
        sel |= (idx.year == y) & (idx.month == m)
        days += calendar.monthrange(y, m)[1]
    assert season["TA"]["f"] == expected_shares(frame.loc[sel, "TA_F_QC"], ta_levels, days * 48)

    year = next(r for r in p["years"] if r["y"] == 2012)
    sel = idx.year == 2012
    assert year["NEE"]["f"] == expected_shares(frame.loc[sel, "NEE_VUT_REF_QC"], nee_levels,
                                               366 * 48)


def test_the_levels_and_the_measured_share_add_up_to_what_is_available(atlas):
    p = atlas.payload
    for rows in (p["months"], p["seasons"], p["years"]):
        for row in rows:
            for key in ("TA", "NEE", "PREC"):
                rec = row[key]
                total = rec["meas"] + sum(rec.get("f", []))
                # Each share is rounded on its own, so they may miss by one per level.
                assert abs(total - rec["avail"]) <= 4, (row["y"], key, rec)


def test_a_fully_measured_span_carries_nothing(atlas):
    january = next(r for r in atlas.payload["months"] if r["y"] == 2011 and r["m"] == 1)
    assert january["TA"]["meas"] == 100
    assert "f" not in january["TA"]


def test_a_flag_of_no_known_convention_says_only_that_it_is_not_zero(unstated, flagged):
    frame, _ = flagged
    fill = var(unstated, "TA")["fill"]
    assert fill["flag"] == "TA_FLAG" and fill["convention"] == "unstated"
    assert fill["levels"] == ["otherwise flagged"]
    month = next(r for r in unstated.payload["months"] if r["y"] == 2011 and r["m"] == 3)
    sel = (frame.index.year == 2011) & (frame.index.month == 3)
    assert month["TA"]["f"] == expected_shares(frame.loc[sel, "TA_FLAG"], [[7, 9]], 31 * 48)


def test_a_variable_without_a_flag_carries_no_fill(unflagged):
    assert var(unflagged, "TA")["fill"] is None
    assert unflagged.loaded["TA"]["fill"] is None
    for rows in ("months", "seasons", "years"):
        assert not any("f" in row["TA"] for row in unflagged.payload[rows])


def test_the_fill_levels_describe_and_do_not_gate(atlas, unflagged):
    """The same series with and without its flag: every statistic is the same."""
    for rows in ("months", "seasons", "years"):
        for a, b in zip(atlas.payload[rows], unflagged.payload[rows]):
            assert {k: a["TA"][k] for k in "vazrn"} == {k: b["TA"][k] for k in "vazrn"}


def test_the_fill_shares_cost_little_of_the_payload(atlas):
    """Every span of this record is filled at every level, which is the worst case for size."""
    full = len(json.dumps(atlas.payload, separators=(",", ":")))
    stripped = json.loads(json.dumps(atlas.payload))
    for rows in ("months", "seasons", "years"):
        for row in stripped[rows]:
            for key in ("TA", "NEE", "PREC"):
                row[key].pop("f", None)
    bare = len(json.dumps(stripped, separators=(",", ":")))
    assert full / bare < 1.05


# -- The page ----------------------------------------------------------------------------------

def read_page(atlas, tmp_path, *hashes):
    page = atlas.write(tmp_path / "atlas.html", quiet=True)
    result = subprocess.run([NODE, str(TEXT), str(page), *hashes], capture_output=True, text=True,
                            encoding="utf-8", timeout=300)
    assert result.returncode == 0, result.stderr
    found = json.loads(result.stdout)
    assert not found["errors"], found["errors"]
    return page, found


@needs_jsdom
def test_the_month_panel_says_how_the_rest_was_filled_in_each_flags_words(atlas, tmp_path):
    month = next(r for r in atlas.payload["months"] if r["y"] == 2011 and r["m"] == 3)
    _, found = read_page(atlas, tmp_path, "#2011-03")
    tiles = found["#2011-03"]["tiles"]
    ta, nee = month["TA"], month["NEE"]
    assert (f"{ta['meas']:.0f} % measured, {ta['f'][0]} % gap-filled, {ta['f'][1]} % from "
            f"reanalysis, {ta['f'][2]} % {varreg.FILL_OTHER}") in tiles
    assert (f"{nee['meas']:.0f} % measured, {nee['f'][0]} % good-quality fill, {nee['f'][1]} % "
            f"medium-quality fill") in tiles
    titles = found["#2011-03"]["titles"]
    assert any(t.startswith("TA_F_QC follows") and "reanalysis" in t for t in titles)
    assert any(t.startswith("NEE_VUT_REF_QC follows") for t in titles)


@needs_jsdom
def test_the_variable_page_splits_the_coverage_chart_by_fill_level(atlas, tmp_path):
    _, found = read_page(atlas, tmp_path, "#var-TA", "#var-NEE")
    ta, nee = found["#var-TA"]["cov"], found["#var-NEE"]["cov"]
    for label in ("gap-filled", "from reanalysis", varreg.FILL_OTHER):
        assert label in ta
    assert "medium-quality fill" not in ta
    assert "TA_F_QC" in ta
    for label in ("good-quality fill", "medium-quality fill", "poor-quality fill"):
        assert label in nee
    assert "reanalysis" not in nee


@needs_jsdom
@pytest.mark.parametrize("which", ["unstated", "unflagged"])
def test_a_flag_without_a_convention_and_no_flag_at_all_render_cleanly(which, request, tmp_path):
    built = request.getfixturevalue(which)
    page, found = read_page(built, tmp_path, "#2011-03", "#var-TA")
    tiles, cov = found["#2011-03"]["tiles"], found["#var-TA"]["cov"]
    if which == "unstated":
        assert "% otherwise flagged" in tiles and "otherwise flagged" in cov
    else:
        assert "flagged" not in tiles and "Above the measured share" not in cov
    result = subprocess.run([NODE, str(SMOKE), str(page)], capture_output=True, text=True,
                            encoding="utf-8", timeout=300)
    assert result.returncode == 0, result.stderr
    problems = json.loads(result.stdout)["problems"]
    assert not problems, problems
