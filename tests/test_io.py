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


def test_stamps_parse_to_what_the_format_string_parse_gave():
    """The arithmetic parse is a faster route to the same index, across leap days and new years."""
    index = pd.date_range("2015-12-31 00:00", "2024-03-01 23:30", freq="30min")
    column = pd.Series(index.strftime("%Y%m%d%H%M").astype("int64"))
    parsed = io._parse_stamps(column)
    by_format = pd.DatetimeIndex(pd.to_datetime(column.astype("int64").astype(str),
                                                format="%Y%m%d%H%M"))
    assert parsed.equals(by_format)
    assert parsed.dtype == by_format.dtype
    assert parsed.equals(pd.DatetimeIndex(index))


@pytest.mark.parametrize("stamp", [20200101, 202013010000, 202002300000])
def test_a_stamp_that_is_not_a_valid_minute_is_refused(stamp):
    """A daily stamp, a thirteenth month and a 30 February all fail rather than land somewhere."""
    with pytest.raises(ValueError):
        io._parse_stamps(pd.Series([202001010000, stamp]))


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


def test_a_file_finer_than_half_hourly_is_refused_rather_than_thinned(tmp_path):
    """The case an hourly file does not cover, because this one does not look wrong.

    Flooring is what lets a middle-stamped record land on the window it belongs to, and it puts
    three ten-minute records in that same window just as willingly; de-duplication then drops two
    of them. Checked after that, the file reads as a complete half-hourly record built from every
    third value - the right number of records, 100 % available, and two thirds of the data gone
    with nothing on the page to say so. So the spacing is read off the stamps the file states.
    """
    frame = synthetic_frame(years=2).resample("10min").ffill()
    path = tmp_path / "tenminute.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="0 days 00:10:00 apart"):
        io.read_fluxnet(path, ["TA"], quiet=True)


def test_a_middle_stamped_half_hourly_file_still_reads(tmp_path):
    """The other side of the same check: flooring exists for this file and must keep working.

    The synthetic frame is stamped at the middle of its windows, so its raw stamps fall on :15 and
    :45 and never on the grid the reader builds. They are 30 minutes apart, which is what the
    spacing check now reads them for, and every one of them survives the floor.
    """
    frame = synthetic_frame(years=2)
    assert set(frame.index.minute) == {15, 45}, "the fixture is meant to be middle-stamped"
    path = tmp_path / "middle.parquet"
    frame.to_parquet(path)
    loaded = io.read_fluxnet(path, ["TA"], quiet=True)
    assert loaded["TA"]["series"].notna().sum() == len(frame)


def test_a_file_without_any_timestamp_is_refused():
    with pytest.raises(ValueError, match="does not\n?\\s*look like a FLUXNET"):
        io._timestamp_index(pd.DataFrame({"TA_F": [1.0, 2.0]}))


def test_a_zoned_index_is_refused_naming_the_zone(tmp_path):
    """FLUXNET time is local standard time with no zone, and the site's offset is not guessed.

    A zoned index cannot meet the zone-free grid, and used to be refused as a file none of whose
    stamps land on it - quoting a first stamp of 2010-01-01 00:00, which plainly does. The message
    has to name the zone and the conversion instead, and not be the grid message.
    """
    frame = synthetic_frame(years=2)
    frame.index = frame.index.tz_localize("UTC")
    path = tmp_path / "utc.parquet"
    frame.to_parquet(path)
    with pytest.raises(ValueError, match="time zone UTC") as refused:
        io.read_fluxnet(path, ["TA"], quiet=True)
    assert "Etc/GMT-1" in str(refused.value)
    assert "land on the half-hourly grid" not in str(refused.value)


def test_a_zoned_index_reads_once_converted_as_the_message_says(tmp_path):
    """The advice in the refusal is itself checked, including the inverted sign of `Etc/GMT`.

    The synthetic frame stands for a site on UTC+1; stored in UTC it is an hour behind. The
    conversion the message quotes has to bring back exactly the stamps the site recorded.
    """
    frame = synthetic_frame(years=2)
    in_utc = frame.index.tz_localize("Etc/GMT-1").tz_convert("UTC")
    assert in_utc[0].hour == 23, "UTC+1 midnight is 23:00 the day before in UTC"

    converted = frame.copy()
    converted.index = in_utc.tz_convert("Etc/GMT-1").tz_localize(None)
    assert converted.index.equals(frame.index)
    path = tmp_path / "converted.parquet"
    converted.to_parquet(path)
    loaded = io.read_fluxnet(path, ["TA"], quiet=True)
    assert loaded["TA"]["series"].notna().sum() == len(frame)


def _with_trailing_row(path, fields):
    """Append one row to a CSV, the way a spreadsheet leaves an empty one at the end of a file."""
    width = len(path.read_text().splitlines()[0].split(","))
    with path.open("a") as handle:
        handle.write(",".join(fields + [""] * (width - len(fields))) + "\n")
    return path


def test_a_blank_trailing_row_is_dropped_and_counted(tmp_path, capsys):
    """A row of empty fields has no timestamp, so it cannot be placed; it must not fail the read.

    It used to stop the read with pandas' own "Cannot convert non-finite values to integer", which
    names neither the file nor the column.
    """
    frame = synthetic_frame(years=2)
    path = _with_trailing_row(to_fluxnet_csv(frame, tmp_path / "blank.csv"), [])
    loaded = io.read_fluxnet(path, ["TA"])
    assert loaded["TA"]["series"].notna().sum() == len(frame)
    assert "row(s) without a timestamp dropped: 1" in capsys.readouterr().out

    io.read_fluxnet(path, ["TA"], quiet=True)
    assert "without a timestamp" not in capsys.readouterr().out


def test_a_file_with_no_timestamp_in_any_row_is_refused(tmp_path):
    path = tmp_path / "undated.csv"
    path.write_text("TIMESTAMP_START,TIMESTAMP_END,TA_F\n,,1.0\n,,2.0\n")
    with pytest.raises(ValueError, match="none of its 2 rows carries a timestamp"):
        io.read_fluxnet(path, ["TA"], quiet=True)


def test_a_stamp_that_is_not_a_number_is_refused_naming_the_column_and_value(tmp_path):
    """Text in the stamp column is a different format, not an empty row, and is not dropped."""
    path = _with_trailing_row(to_fluxnet_csv(synthetic_frame(years=2), tmp_path / "iso.csv"),
                              ["2011-12-31 23:30"])
    with pytest.raises(ValueError, match="TIMESTAMP_START holds '2011-12-31 23:30'"):
        io.read_fluxnet(path, ["TA"], quiet=True)


def test_missing_stamps_parse_to_nat_in_place():
    """The rows around an empty stamp keep their own stamps; only the empty one has none."""
    parsed = io._parse_stamps(pd.Series([202001010000, None, 202001010100]))
    assert parsed[0] == pd.Timestamp("2020-01-01 00:00")
    assert pd.isna(parsed[1])
    assert parsed[2] == pd.Timestamp("2020-01-01 01:00")
    as_text = io._parse_stamps(pd.Series(["202001010000", " ", "202001010100"]))
    assert as_text[1:2].isna().all() and as_text[[0, 2]].equals(parsed[[0, 2]])


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


def test_a_column_the_registry_knows_keeps_the_registry_factor():
    """Naming a candidate is a choice of column, not a choice of unit."""
    names = ["NEE_CUT_REF"]
    assert io.resolve(names, {"NEE": "NEE_CUT_REF"})["NEE"]["factor"] == varreg.UMOL_TO_GC
    # The string form and the dict form are the same mapping written two ways.
    spec = io.resolve(names, {"NEE": dict(column="NEE_CUT_REF")})["NEE"]
    assert spec["factor"] == varreg.UMOL_TO_GC


def test_a_named_carbon_column_reads_in_the_canonical_unit(flux_parquet_path):
    """The whole point of it: `--var NEE=NEE_VUT_REF` used to fail the plausible range."""
    by_registry = io.read_fluxnet(flux_parquet_path, ["NEE"], quiet=True)["NEE"]
    by_name = io.read_fluxnet(flux_parquet_path, {"NEE": "NEE_VUT_REF"}, quiet=True)["NEE"]
    assert by_name["v"].factor == varreg.UMOL_TO_GC
    pd.testing.assert_series_equal(by_registry["series"], by_name["series"])


def test_a_factor_the_caller_states_wins_over_the_registry():
    """Including an explicit 1.0, which is a statement and not silence."""
    names = ["NEE_VUT_REF"]
    assert io.resolve(names, {"NEE": dict(column="NEE_VUT_REF", factor=1.0)})["NEE"]["factor"] == 1.0
    assert io.resolve(names, {"NEE": dict(column="NEE_VUT_REF", factor=2.5)})["NEE"]["factor"] == 2.5


def test_a_column_the_registry_does_not_know_still_defaults_to_one(frame):
    """A locally named series has no candidate to inherit from, so nothing is converted."""
    renamed = frame.rename(columns={"TA_F": "my_temperature"})
    assert io.resolve(renamed, {"TA": "my_temperature"})["TA"]["factor"] == 1.0


# Every u* selection of NEE's flag a FULLSET file carries, as the CH-Oe2 header lists them.
BOTH_SELECTIONS = ["NEE_VUT_REF_QC", "NEE_CUT_REF_QC", "NEE_VUT_USTAR50_QC", "NEE_CUT_USTAR50_QC",
                   "NEE_VUT_MEAN_QC", "NEE_CUT_MEAN_QC", "NEE_VUT_25_QC", "NEE_CUT_25_QC"]


@pytest.mark.parametrize("column, flag", [
    ("GPP_NT_CUT_REF", "NEE_CUT_REF_QC"),
    ("GPP_DT_CUT_REF", "NEE_CUT_REF_QC"),
    ("GPP_NT_VUT_USTAR50", "NEE_VUT_USTAR50_QC"),
    ("GPP_DT_CUT_USTAR50", "NEE_CUT_USTAR50_QC"),
    ("RECO_NT_CUT_REF", "NEE_CUT_REF_QC"),
    ("RECO_DT_VUT_USTAR50", "NEE_VUT_USTAR50_QC"),
    ("RECO_NT_CUT_MEAN", "NEE_CUT_MEAN_QC"),
    ("GPP_DT_VUT_25", "NEE_VUT_25_QC"),
    ("GPP_NT_VUT_REF", "NEE_VUT_REF_QC"),
])
def test_a_named_partitioning_product_takes_the_flag_of_its_own_nee(column, flag):
    """GPP and RECO take NEE's flag, and it has to be the NEE of the same u* selection.

    The registry's list starts with `NEE_VUT_REF_QC`, so taking the first present entry gave
    `GPP_NT_CUT_REF` the gap-filling record of the other threshold on any file carrying both.
    """
    key = column.split("_")[0]
    names = [column] + BOTH_SELECTIONS
    assert io.resolve(names, {key: column})[key]["qc"] == flag


def test_a_partitioning_product_without_its_partner_falls_back_to_the_list():
    """Where the file lacks the paired flag, the registry's order still decides."""
    names = ["GPP_NT_CUT_REF", "NEE_VUT_REF_QC"]
    assert io.resolve(names, {"GPP": "GPP_NT_CUT_REF"})["GPP"]["qc"] == "NEE_VUT_REF_QC"
    # And a stated flag still wins over the pairing.
    stated = io.resolve(["GPP_NT_CUT_REF"] + BOTH_SELECTIONS,
                        {"GPP": dict(column="GPP_NT_CUT_REF", qc="NEE_VUT_REF_QC")})
    assert stated["GPP"]["qc"] == "NEE_VUT_REF_QC"


def test_the_default_resolution_of_the_partitioning_products_is_unchanged():
    """The pairing applies to a named column; the unaided resolution is the registry's, as before."""
    names = (["GPP_NT_VUT_REF", "GPP_NT_CUT_REF", "RECO_NT_VUT_REF", "RECO_NT_CUT_REF"]
             + BOTH_SELECTIONS)
    specs = io.resolve(names, ["GPP", "RECO"])
    for key in ("GPP", "RECO"):
        assert specs[key]["column"] == f"{key}_NT_VUT_REF"
        assert specs[key]["qc"] == "NEE_VUT_REF_QC"
        assert specs[key] == io.available(names)[key]


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


def test_a_file_the_fast_reader_refuses_as_malformed_still_reads(tmp_path):
    """A row wider than the header is refused by pyarrow and tolerated by the C parser."""
    frame = synthetic_frame(years=2)
    path = to_fluxnet_csv(frame, tmp_path / "ragged.csv")
    lines = path.read_text().splitlines()
    lines[100] += ",surplus"
    path.write_text("\n".join(lines) + "\n")
    with pytest.raises(ValueError):
        pd.read_csv(path, usecols=["TA_F"], engine="pyarrow")
    loaded = io.read_fluxnet(path, ["TA"], quiet=True)
    assert loaded["TA"]["series"].notna().sum() == len(frame)


def test_running_out_of_memory_is_not_retried_with_the_slower_parser(csv_path, monkeypatch):
    """The fallback is for a file pyarrow finds malformed, not for every failure it meets.

    Retrying a `MemoryError` with the C parser asks for more memory than the attempt that ran out.
    """
    calls = []
    real = pd.read_csv

    def read_csv(*args, **kwargs):
        calls.append(kwargs.get("engine"))
        if kwargs.get("engine") == "pyarrow":
            raise MemoryError("out of memory")
        return real(*args, **kwargs)

    monkeypatch.setattr(io.pd, "read_csv", read_csv)
    with pytest.raises(MemoryError):
        io._read_frame(csv_path, usecols=["TIMESTAMP_START", "TA_F"])
    assert calls == ["pyarrow"]


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


def test_naming_a_registry_column_keeps_its_quality_flag(parquet_path):
    """The flag follows the column, exactly as the unit factor does.

    Naming the very column the registry would have chosen used to drop the flag beside it, and a
    series read without a flag counts every present record as measured. That figure is what the
    hatching, the sparse badge, `meta.thin` and the build's coverage warning are all taken from, so
    the page reported a fully measured record where the file states it is half gap-filled.
    """
    default = io.read_fluxnet(parquet_path, ["TA"], quiet=True)["TA"]
    named = io.read_fluxnet(parquet_path, {"TA": "TA_F"}, quiet=True)["TA"]
    assert named["v"].column == default["v"].column
    assert default["v"].qc_column is not None
    assert named["v"].qc_column == default["v"].qc_column
    assert named["measured"].mean() == default["measured"].mean()


def test_a_stated_quality_flag_still_wins_over_the_inherited_one(parquet_path):
    """Inheritance fills a silence; it does not override a caller who named a flag."""
    loaded = io.read_fluxnet(parquet_path, {"TA": dict(column="TA_F", qc="P_F_QC")}, quiet=True)
    assert loaded["TA"]["v"].qc_column == "P_F_QC"


def test_a_column_the_registry_does_not_know_inherits_no_flag(tmp_path):
    """The registry's flags describe the registry's columns and nothing else.

    A caller's own series, named on a file that happens to carry `TA_F_QC` as well, used to take
    that flag - so its measured share was read off the gap-filling record of a different column.
    """
    frame = synthetic_frame(years=2)
    frame["air_temp"] = frame["TA_F"]
    path = tmp_path / "own.parquet"
    frame.to_parquet(path)

    own = io.read_fluxnet(path, {"TA": dict(column="air_temp")}, quiet=True)["TA"]
    assert own["v"].qc_column is None
    assert own["measured"].mean() == own["series"].notna().mean()

    # The registry's own column still inherits its flag, and a stated flag still wins.
    assert io.read_fluxnet(path, {"TA": "TA_F"}, quiet=True)["TA"]["v"].qc_column == "TA_F_QC"
    stated = io.read_fluxnet(path, {"TA": dict(column="air_temp", qc="TA_F_QC")}, quiet=True)
    assert stated["TA"]["v"].qc_column == "TA_F_QC"
