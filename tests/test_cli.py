"""The command line: argument parsing, the mapping it assembles, and one build end to end."""

from __future__ import annotations

import argparse

import pytest

from conftest import synthetic_frame
from fluxatlas import cli


def run(argv):
    """Call the CLI in-process, so a failure shows a traceback rather than an exit code."""
    return cli.main(argv)


# -- Discovery -------------------------------------------------------------------------------------

def test_list_prints_what_the_registry_finds(parquet_path, capsys):
    assert run([str(parquet_path), "--list"]) == 0
    out = capsys.readouterr().out
    assert "TA" in out and "TA_F" in out and "TA_F_QC" in out
    assert "not found" in out and "VPD" in out


def test_list_on_a_file_with_local_names_says_so(tmp_path, capsys):
    frame = synthetic_frame(years=2).rename(columns={"TA_F": "air_temp"})
    path = tmp_path / "local.parquet"
    frame.to_parquet(path)
    assert run([str(path), "--list"]) == 0
    out = capsys.readouterr().out
    assert "--var TA=" in out          # the flag that solves it is named


def test_a_missing_input_is_reported(tmp_path):
    with pytest.raises(SystemExit, match="no such file"):
        run([str(tmp_path / "nope.csv"), "--list"])


# -- Assembling the mapping ------------------------------------------------------------------------

def parse(argv):
    """The mapping the CLI would hand to `Atlas` for these arguments.

    Assembled from the four variable flags only, which is all `build_mapping` reads, so these tests
    stay about the mapping rather than about the rest of the argument surface.
    """
    ns = argparse.Namespace()
    for flag, dest in (("--vars", "vars"), ("--var", "var"), ("--qc", "qc"),
                       ("--factor", "factor")):
        values = [argv[i + 1] for i, item in enumerate(argv) if item == flag]
        setattr(ns, dest, values or None)
    return cli.build_mapping(ns)


def test_no_variable_flags_means_everything_the_file_has():
    assert parse([]) is None


def test_vars_selects_by_canonical_key():
    assert parse(["--vars", "TA,PREC"]) == {"TA": None, "PREC": None}


def test_vars_is_repeatable_and_comma_separated():
    assert set(parse(["--vars", "TA", "--vars", "PREC,SW_IN"])) == {"TA", "PREC", "SW_IN"}


def test_var_names_the_column():
    assert parse(["--var", "TA=air_temp"]) == {"TA": dict(column="air_temp")}


def test_qc_and_factor_refine_a_var():
    mapping = parse(["--var", "VPD=vpd_pa", "--qc", "VPD=vpd_flag", "--factor", "VPD=0.001"])
    assert mapping == {"VPD": dict(column="vpd_pa", qc="vpd_flag", factor=0.001)}


def test_the_two_forms_combine():
    mapping = parse(["--vars", "PREC", "--var", "TA=air_temp"])
    assert mapping == {"PREC": None, "TA": dict(column="air_temp")}


def test_a_flag_without_its_var_is_refused():
    with pytest.raises(SystemExit, match="has no --var mapping"):
        parse(["--qc", "TA=some_flag"])


def test_an_unknown_key_is_refused_by_every_flag():
    for argv in (["--vars", "NOPE"], ["--var", "NOPE=col"]):
        with pytest.raises(SystemExit, match="unknown variable"):
            parse(argv)


def test_a_malformed_pair_is_refused():
    with pytest.raises(SystemExit, match="expects KEY=VALUE"):
        parse(["--var", "TA"])


def test_a_non_numeric_factor_is_refused():
    with pytest.raises(SystemExit, match="not a number"):
        parse(["--var", "VPD=col", "--factor", "VPD=lots"])


# -- Building --------------------------------------------------------------------------------------

def test_a_build_by_canonical_key(parquet_path, tmp_path):
    out = tmp_path / "atlas.html"
    assert run([str(parquet_path), "-o", str(out), "--vars", "TA", "--no-hourly", "-q"]) == 0
    assert out.stat().st_size > 100_000


def test_a_build_by_named_column(tmp_path):
    """The case the CLI exists for: a file whose columns were never named for FLUXNET."""
    frame = synthetic_frame(years=10).rename(
        columns={"TA_F": "air_temp", "TA_F_QC": "TA_ISFILLED"})
    path = tmp_path / "local.parquet"
    frame.to_parquet(path)
    out = tmp_path / "atlas.html"
    assert run([str(path), "-o", str(out), "--var", "TA=air_temp",
                "--qc", "TA=TA_ISFILLED", "--no-hourly", "-q"]) == 0
    assert out.stat().st_size > 100_000


def test_the_output_path_defaults_beside_the_input(parquet_path, tmp_path):
    frame = synthetic_frame(years=10)
    path = tmp_path / "FLX_XX-Syn_HH_2010-2019.parquet"
    frame.to_parquet(path)
    assert run([str(path), "--vars", "TA", "--no-hourly", "-q"]) == 0
    assert (tmp_path / "XX-Syn_atlas.html").exists()


def test_the_span_and_title_can_be_set(parquet_path, tmp_path):
    out = tmp_path / "atlas.html"
    run([str(parquet_path), "-o", str(out), "--vars", "TA", "--no-hourly", "-q",
         "--first-year", "2012", "--last-year", "2019", "--title", "A stated title"])
    html = out.read_text(encoding="utf-8")
    assert "<title>A stated title</title>" in html
    assert "2012" in html and "2020" not in html.split("<title>")[0][:400]


def test_quiet_prints_nothing(parquet_path, tmp_path, capsys):
    run([str(parquet_path), "-o", str(tmp_path / "a.html"), "--vars", "TA", "--no-hourly", "-q"])
    assert capsys.readouterr().out == ""


def test_the_module_entry_point_exists():
    import fluxatlas.__main__ as entry
    assert entry.main is cli.main
