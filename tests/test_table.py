"""`Atlas.table`: the figures behind the tiles, as a DataFrame read from the same payload."""

from __future__ import annotations

import pandas as pd
import pytest

import fluxatlas as fa

FIELDS = (("v", ""), ("a", "_anom"), ("z", "_z"), ("p", "_pctn"), ("r", "_rank"),
          ("n", "_rank_n"), ("meas", "_meas"), ("avail", "_avail"))
LISTS = {"month": "months", "season": "seasons", "year": "years"}


def _same(got, want):
    if want is None:
        return pd.isna(got)
    return got == want


@pytest.mark.parametrize("scale", ["month", "season", "year"])
def test_one_row_per_span(flux_atlas, scale):
    table = flux_atlas.table(scale)
    assert len(table) == len(flux_atlas.payload[LISTS[scale]])
    assert table.index.is_unique


def test_months_are_indexed_by_their_first_day(flux_atlas):
    table = flux_atlas.table("month")
    assert isinstance(table.index, pd.DatetimeIndex)
    assert table.index.name == "month"
    assert table.index[0] == pd.Timestamp(flux_atlas.first_year, 1, 1)
    assert table.index[-1] == pd.Timestamp(flux_atlas.last_year, 12, 1)
    assert (table.index.day == 1).all()


def test_seasons_are_indexed_by_year_and_season(flux_atlas):
    table = flux_atlas.table("season")
    assert list(table.index.names) == ["year", "season"]
    keys = [d["key"] for d in flux_atlas.payload["season_defs"]]
    assert list(table.loc[flux_atlas.first_year].index) == keys


def test_years_are_indexed_by_year(flux_atlas):
    table = flux_atlas.table("year")
    assert table.index.name == "year"
    assert list(table.index) == list(range(flux_atlas.first_year, flux_atlas.last_year + 1))


@pytest.mark.parametrize("scale", ["month", "season", "year"])
def test_the_figures_are_the_payloads(flux_atlas, scale):
    """Read from the payload, so the table cannot state a figure the page does not."""
    table = flux_atlas.table(scale)
    rows = flux_atlas.payload[LISTS[scale]]
    for i in (0, 1, len(rows) // 2, len(rows) - 1):
        row = rows[i]
        for key in flux_atlas.variables:
            for field, suffix in FIELDS:
                got, want = table.iloc[i][key + suffix], row[key][field]
                assert _same(got, want), (scale, i, key + suffix, got, want)
        assert table.iloc[i]["badges"] == tuple(b["k"] for b in row["b"])


def test_a_figure_is_found_by_its_label(flux_atlas):
    """Spot check by index rather than position: July of the second year."""
    y = flux_atlas.first_year + 1
    row = next(r for r in flux_atlas.payload["months"] if r["y"] == y and r["m"] == 7)
    table = flux_atlas.table()
    assert table.loc[pd.Timestamp(y, 7, 1), "TA"] == row["TA"]["v"]
    assert table.loc[pd.Timestamp(y, 7, 1), "NEE_anom"] == row["NEE"]["a"]
    season = next(r for r in flux_atlas.payload["seasons"] if r["y"] == y and r["s"] == "JJA")
    assert flux_atlas.table("season").loc[(y, "JJA"), "GPP"] == season["GPP"]["v"]


def test_uncertainty_appears_only_where_the_build_carries_one(flux_atlas):
    table = flux_atlas.table("year")
    carried = {v["key"] for v in flux_atlas.payload["variables"] if v["unc_columns"]}
    assert carried == {"NEE", "GPP", "RECO"}
    for key in flux_atlas.variables:
        assert (f"{key}_unc" in table.columns) == (key in carried)
    rows = flux_atlas.payload["years"]
    assert list(table["NEE_unc"]) == [row["NEE"]["u"] for row in rows]


def test_ranks_are_integers_and_a_missing_one_is_missing(flux_atlas):
    table = flux_atlas.table("season")
    assert str(table["TA_rank"].dtype) == "Int64"
    assert str(table["TA_rank_n"].dtype) == "Int64"
    missing = [i for i, row in enumerate(flux_atlas.payload["seasons"]) if row["TA"]["r"] is None]
    assert missing, "the first winter is clipped and should carry no rank"
    assert table["TA_rank"].iloc[missing].isna().all()


def test_an_unknown_scale_is_refused(flux_atlas):
    with pytest.raises(ValueError, match="scale"):
        flux_atlas.table("week")


def test_a_build_without_seasons_gives_an_empty_season_table(parquet_path):
    atlas = fa.Atlas(parquet_path, ["TA"], hourly=False, quiet=True, seasons="none")
    table = atlas.table("season")
    assert table.empty
    assert list(table.index.names) == ["year", "season"]
    assert "TA" in table.columns
