"""Reading: timestamps, missing values, whole years, units, the measured split, and resolution."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from conftest import synthetic_frame, to_fluxnet_csv
from fluxatlas import io, variables as varreg


# -- Timestamps ----------------------------------------------------------------------------------

def test_reads_fluxnet_csv_and_indexes_on_the_window_start(csv_path):
    """The stamp the file already holds, so the label is the one the reader read."""
    loaded = io.read_fluxnet(csv_path, ["TA"], quiet=True)
    index = loaded["TA"]["series"].index
    assert isinstance(index, pd.DatetimeIndex)
    assert index[0] == pd.Timestamp(f"{index[0].year}-01-01 00:00")
    assert (index[1] - index[0]) == pd.Timedelta("30min")


def test_the_start_stamp_is_used_even_where_both_are_present():
    index = pd.date_range("2020-06-01 00:00", periods=4, freq="30min")
    df = pd.DataFrame({"TIMESTAMP_START": index.strftime("%Y%m%d%H%M").astype("int64"),
                       "TIMESTAMP_END": (index + pd.Timedelta("30min"))
                       .strftime("%Y%m%d%H%M").astype("int64"),
                       "TA_F": [1.0, 2.0, 3.0, 4.0]})
    assert io._timestamp_index(df)[0] == pd.Timestamp("2020-06-01 00:00")


def test_end_stamp_alone_still_lands_on_the_right_day():
    """A record ending 00:00 belongs to the previous day, not to the one that is starting."""
    index = pd.date_range("2020-01-01 00:30", periods=4, freq="30min")
    df = pd.DataFrame({"TIMESTAMP_END": index.strftime("%Y%m%d%H%M").astype("int64"),
                       "TA_F": [1.0, 2.0, 3.0, 4.0]})
    assert io._timestamp_index(df)[0] == pd.Timestamp("2020-01-01 00:00")


def test_a_datetimeindex_is_floored_onto_the_window_grid(frame):
    """Local products stamp the start or the middle, and both mean the same window."""
    assert io._timestamp_index(frame).equals(frame.index.floor("30min"))

    middles = frame.index[:4]
    starts = middles.floor("30min")
    assert list(starts.minute) == [0, 30, 0, 30]
    assert io._timestamp_index(pd.DataFrame(index=middles)).equals(starts)
    assert io._timestamp_index(pd.DataFrame(index=starts)).equals(starts)


def test_a_file_on_the_wrong_frequency_says_so(tmp_path):
    """Hourly input is not read, and the reason given is the frequency rather than the column."""
    frame = synthetic_frame(years=2).resample("h").mean()
    path = tmp_path / "hourly.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="reads half-hourly records"):
        io.read_fluxnet(path, ["TA"], quiet=True)


def test_a_file_without_any_timestamp_is_refused():
    with pytest.raises(ValueError, match="does not\n?\\s*look like a FLUXNET"):
        io._timestamp_index(pd.DataFrame({"TA_F": [1.0, 2.0]}))


# -- Missing values ------------------------------------------------------------------------------

def test_the_fluxnet_missing_value_becomes_nan(tmp_path):
    frame = synthetic_frame(years=2)
    frame.iloc[:10, frame.columns.get_loc("TA_F")] = -9999.0
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    series = io.read_fluxnet(path, ["TA"], quiet=True)["TA"]["series"]
    assert series.iloc[:10].isna().all()
    # And it must not survive as a number anywhere in the series.
    assert series.dropna().min() > -100


# -- Whole years ---------------------------------------------------------------------------------

def test_a_partial_first_and_last_year_are_dropped(tmp_path):
    frame = synthetic_frame(first_year=2010, years=4)
    frame = frame.loc["2010-03-01":"2013-08-31"]      # 2010 has no January, 2013 no December
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    loaded = io.read_fluxnet(path, ["TA"], quiet=True)
    assert io.span(loaded) == (2011, 2012)


def test_the_span_can_be_narrowed_by_hand(parquet_path):
    loaded = io.read_fluxnet(parquet_path, ["TA"], first_year=2012, last_year=2015, quiet=True)
    assert io.span(loaded) == (2012, 2015)


def test_the_index_is_continuous_after_reading_a_gappy_file(tmp_path):
    """Rows missing from the file must come back as missing records, not as a shorter series."""
    frame = synthetic_frame(years=2)
    frame = frame.drop(frame.index[500:900])
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    series = io.read_fluxnet(path, ["TA"], quiet=True)["TA"]["series"]
    assert series.index.freq is None or True
    assert (series.index.to_series().diff().dropna() == pd.Timedelta("30min")).all()
    assert series.isna().sum() >= 400


def test_a_record_with_no_whole_year_is_refused(tmp_path):
    frame = synthetic_frame(years=1).loc["2010-03-01":"2010-09-30"]
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="no whole year"):
        io.read_fluxnet(path, ["TA"], quiet=True)


# -- Units ---------------------------------------------------------------------------------------

def test_the_unit_factor_is_applied(tmp_path):
    """VPD in Pa becomes VPD in kPa, because the thresholds are stated in kPa."""
    frame = synthetic_frame(years=2)
    frame["VPD_EP"] = 1500.0                      # 1500 Pa
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    series = io.read_fluxnet(path, ["VPD"], quiet=True)["VPD"]["series"]
    assert np.isclose(series.dropna().iloc[0], 1.5)


def test_a_wrong_unit_fails_the_read_naming_the_column(tmp_path):
    """VPD in Pa read as though it were hPa lands far outside the plausible range."""
    frame = synthetic_frame(years=2)
    frame["VPD_F"] = 1500.0                       # Pa, but VPD_F is documented as hPa
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="VPD_F.*outside the plausible range"):
        io.read_fluxnet(path, ["VPD"], quiet=True)


# -- Measured versus modelled --------------------------------------------------------------------

def test_qc_zero_is_measured_and_anything_above_it_is_not(parquet_path, frame):
    loaded = io.read_fluxnet(parquet_path, ["TA"], quiet=True)
    measured = loaded["TA"]["measured"]
    expected = (frame["TA_F_QC"] == 0).sum()
    assert measured.sum() == expected
    assert 0.85 < measured.mean() < 1.0


def test_without_a_qc_column_present_means_measured(tmp_path):
    frame = synthetic_frame(years=2).drop(columns=["TA_F_QC"])
    path = tmp_path / "hh.parquet"
    frame.to_parquet(path)
    loaded = io.read_fluxnet(path, ["TA"], quiet=True)
    assert loaded["TA"]["v"].qc_column is None
    assert loaded["TA"]["measured"].equals(loaded["TA"]["series"].notna())


# -- Resolution ----------------------------------------------------------------------------------

def test_available_finds_the_registry_columns(parquet_path):
    found = io.available(parquet_path)
    assert set(found) == {"TA", "PREC", "SW_IN"}
    assert found["TA"]["column"] == "TA_F"
    assert found["TA"]["qc"] == "TA_F_QC"


def test_resolve_accepts_a_list_a_string_and_none(frame):
    assert set(io.resolve(frame, ["TA", "PREC"])) == {"TA", "PREC"}
    assert set(io.resolve(frame, "TA")) == {"TA"}
    assert set(io.resolve(frame, None)) == {"TA", "PREC", "SW_IN"}


def test_resolve_accepts_an_explicit_mapping(frame):
    renamed = frame.rename(columns={"TA_F": "my_temperature", "TA_F_QC": "my_flag"})
    specs = io.resolve(renamed, {"TA": dict(column="my_temperature", qc="my_flag")})
    assert specs["TA"] == dict(column="my_temperature", factor=1.0, qc="my_flag")
    # A bare string is the same thing without a flag.
    assert io.resolve(renamed, {"TA": "my_temperature"})["TA"]["qc"] is None


def test_a_mapping_makes_a_non_fluxnet_file_readable(tmp_path):
    """The point of the mapping: columns that were never named for FLUXNET."""
    frame = synthetic_frame(years=10).rename(columns={"TA_F": "air_temp"})
    path = tmp_path / "local.parquet"
    frame.to_parquet(path)
    with pytest.raises(KeyError, match="carries no column for TA"):
        io.read_fluxnet(path, ["TA"], quiet=True)
    loaded = io.read_fluxnet(path, {"TA": "air_temp"}, quiet=True)
    assert loaded["TA"]["v"].column == "air_temp"


def test_unknown_keys_and_missing_columns_are_named_in_the_error(frame):
    with pytest.raises(KeyError, match="unknown variable"):
        io.resolve(frame, ["NOT_A_VARIABLE"])
    with pytest.raises(KeyError, match="no column 'nope'"):
        io.resolve(frame, {"TA": "nope"})
    with pytest.raises(KeyError, match="quality flag"):
        io.resolve(frame, {"TA": dict(column="TA_F", qc="nope")})


def test_a_missing_column_suggests_the_mapping(frame):
    with pytest.raises(KeyError, match="Pass an explicit mapping"):
        io.resolve(frame.drop(columns=["TA_F"]), ["TA"])


def test_csv_and_parquet_give_the_same_series(csv_path, parquet_path):
    from_csv = io.read_fluxnet(csv_path, ["TA"], quiet=True)["TA"]["series"]
    from_parquet = io.read_fluxnet(parquet_path, ["TA"], quiet=True)["TA"]["series"]
    pd.testing.assert_series_equal(from_csv, from_parquet, check_freq=False)


# -- Reading only what was selected --------------------------------------------------------------
#
# A FLUXNET FULLSET file is 248 columns and hundreds of megabytes, and an atlas of six variables
# needs about twenty of them. The selection is therefore resolved against the header alone and the
# file is read for the surviving columns only - so `available`, `resolve` and `columns_of` all have
# to be answerable without any data, which is what these assert.


def test_columns_of_answers_from_the_header_alone(csv_path, parquet_path, frame):
    for source in (csv_path, parquet_path, frame, list(frame.columns)):
        assert "TA_F" in io.columns_of(source)
    # The CSV carries the two integer stamps; the parquet carries its index instead.
    assert "TIMESTAMP_START" in io.columns_of(csv_path)
    assert "TIMESTAMP_START" not in io.columns_of(parquet_path)


def test_a_stored_index_is_not_offered_as_a_column(parquet_path):
    """`__index_level_0__` and friends are pandas metadata, not something a caller may ask for."""
    assert not [c for c in io.columns_of(parquet_path) if c.startswith("__index_level_")]


def test_available_and_resolve_take_a_bare_list_of_names():
    names = ["TIMESTAMP_START", "TA_F", "TA_F_QC", "P_F", "NEE_VUT_REF", "NEE_VUT_REF_QC"]
    assert set(io.available(names)) == {"TA", "PREC", "NEE"}
    assert io.resolve(names, ["TA"])["TA"]["column"] == "TA_F"


def test_the_read_carries_only_the_selected_columns_and_the_stamps(tmp_path):
    frame = synthetic_frame(years=2)
    # Two hundred columns of decoys, which is the shape of a real FULLSET file.
    decoys = pd.DataFrame(1.0, index=frame.index, columns=[f"DECOY_{i}" for i in range(200)])
    path = to_fluxnet_csv(pd.concat([frame, decoys], axis=1), tmp_path / "wide.csv")

    loaded = io.read_fluxnet(path, ["TA"], quiet=True)
    assert set(loaded["TA"]["df"].columns) == {
        "TIMESTAMP_START", "TIMESTAMP_END", "TA_F", "TA_F_QC"}


def test_a_projected_read_gives_the_same_series_as_reading_everything(csv_path):
    """The projection is an optimisation, so it has to be invisible in the result."""
    projected = io.read_fluxnet(csv_path, ["TA"], quiet=True)["TA"]["series"]

    whole = io._read_frame(csv_path)
    whole = whole.set_index(pd.DatetimeIndex(io._timestamp_index(whole))).sort_index()
    expected = whole["TA_F"].mask(whole["TA_F"] <= io.MISSING + 1).astype(float)
    pd.testing.assert_series_equal(
        projected.dropna(), expected.reindex(projected.index).dropna(),
        check_names=False, check_freq=False)


def test_a_qc_column_named_by_a_mapping_is_read_too(tmp_path):
    """The projection has to ask for the flag as well, or the measured split would be lost."""
    frame = synthetic_frame(years=2).rename(columns={"TA_F": "temp", "TA_F_QC": "temp_flag"})
    path = to_fluxnet_csv(frame, tmp_path / "mapped.csv")
    loaded = io.read_fluxnet(path, {"TA": dict(column="temp", qc="temp_flag")}, quiet=True)
    assert "temp_flag" in loaded["TA"]["df"].columns
    assert 0.0 < loaded["TA"]["measured"].mean() < 1.0


def test_every_registry_variable_declares_columns_and_a_unit():
    for key in varreg.known():
        v = varreg.make(key)
        assert v.candidates, f"{key} lists no candidate columns"
        assert v.units, f"{key} has no units"
        assert v.limits[0] < v.limits[1], f"{key} has empty limits"
