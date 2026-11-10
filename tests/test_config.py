"""One settings file for a whole build: `read_config`, `Atlas.from_config` and `--config`.

The file is checked in full before any data file is opened, so most of what is asserted here costs
no build at all. The builds that do run use the site fixtures of `test_site_settings.py`, which
exercise every setting, so a file that reproduces their payload states every setting a file can.
"""

from __future__ import annotations

import copy
import json
import os
import re

import pytest

import fluxatlas as fa
from fluxatlas import cli
from test_site_settings import (  # noqa: F401 - the fixtures are used by name
    FILL_LEGEND, SOURCE_LEGEND, TS_LEGEND, as_recorded, reference_path, site_atlas, site_frame,
    site_path, site_variables)


def written(variables):
    """A Python mapping of the site settings as a settings file writes it."""
    out = {}
    for key, want in variables.items():
        if isinstance(want, str):
            out[key] = want
            continue
        entry = dict(want)
        if "qc_legend" in entry:
            entry["qc_legend"] = as_recorded(entry["qc_legend"])
        if "measured_codes" in entry:
            entry["measured_codes"] = list(entry["measured_codes"])
        if isinstance(entry.get("source"), dict) and "legend" in entry["source"]:
            entry["source"] = dict(entry["source"], legend=as_recorded(entry["source"]["legend"]))
        out[key] = entry
    return out


def settings(site_path, reference_path, **extra):
    """The settings of `site_atlas` as a file beside the input states them, with relative paths."""
    folder = site_path.parent
    out = {
        "input": site_path.name,
        "output": "pages/site.html",
        "site": "XX-Syn",
        "hourly": False,
        "variables": written(site_variables()),
        "primary": {"SWC": "SWC@0.3"},
        "lat": 47.5, "lon": 8.4, "utc_offset": 1,
        "reference": {"file": os.path.relpath(reference_path, folder), "station": "Syn reference",
                      "distance_km": 2.0, "elevation_m": 600, "shift": -15},
    }
    out.update(extra)
    return out


def write_settings(folder, found, name="site.json"):
    path = folder / name
    path.write_text(json.dumps(found, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


@pytest.fixture(scope="module")
def config_path(site_path, reference_path):
    return write_settings(site_path.parent, settings(site_path, reference_path))


def without_build_time(payload):
    payload = copy.deepcopy(payload)
    payload["meta"].pop("generated", None)
    return payload


def page_payload(path):
    html = path.read_text(encoding="utf-8")
    return json.loads(re.search(r'<script id="payload" type="application/json">(.*?)</script>',
                                html, re.S).group(1))


# -- The same build by both routes ----------------------------------------------------------------

def test_a_settings_file_builds_the_payload_of_the_same_python_call(site_atlas, config_path,
                                                                     tmp_path, monkeypatch):
    # Run from elsewhere, so a path the file states relative to itself is not found by accident.
    monkeypatch.chdir(tmp_path)
    atlas = fa.Atlas.from_config(config_path, quiet=True)
    assert without_build_time(atlas.payload) == without_build_time(site_atlas.payload)
    assert atlas.provenance == site_atlas.provenance


def test_the_command_line_builds_the_same_payload_from_the_file(site_atlas, config_path, tmp_path,
                                                                monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert cli.main(["--config", str(config_path), "-q"]) == 0
    out = config_path.parent / "pages" / "site.html"
    assert out.exists()
    # Compared page with page: the page states the payload as JSON, which the object does not.
    python = site_atlas.write(tmp_path / "python.html", quiet=True)
    assert without_build_time(page_payload(out)) == without_build_time(page_payload(python))


# -- What the file is read as ---------------------------------------------------------------------

def test_a_relative_path_is_taken_from_the_files_own_folder(config_path, site_path,
                                                            reference_path, tmp_path,
                                                            monkeypatch):
    monkeypatch.chdir(tmp_path)
    found = fa.read_config(config_path)
    assert found["path"].resolve() == site_path.resolve()
    assert found["out"].resolve() == (site_path.parent / "pages" / "site.html").resolve()
    assert found["reference"]["file"].resolve() == reference_path.resolve()
    # An absolute path is kept as it is.
    absolute = write_settings(tmp_path, {"input": str(site_path.resolve())}, "absolute.json")
    assert fa.read_config(absolute)["path"] == site_path.resolve()


def test_the_file_returns_the_keyword_arguments_of_build_atlas(config_path):
    found = fa.read_config(config_path)
    assert set(found) == {"path", "out", "site", "hourly", "variables", "primary", "lat", "lon",
                          "utc_offset", "reference"}
    # A column named alone, and a key named with nothing, read as an entry would.
    assert found["variables"]["SW_OUT"] == {"column": "SW_OUT"}
    listed = write_settings(config_path.parent, {"variables": ["TA", "PA"]}, "listed.json")
    assert fa.read_config(listed) == {"variables": {"TA": {}, "PA": {}}}


def test_a_null_is_a_setting_left_out_except_for_the_flag(tmp_path):
    path = write_settings(tmp_path, {"site": None, "variables": {
        "TA": {"column": "TA_F", "qc": None, "raw": None, "notes": None}}})
    assert fa.read_config(path) == {"variables": {"TA": {"column": "TA_F", "qc": None}}}


def test_a_yaml_file_reads_as_the_json_file_does(config_path, site_path, reference_path):
    yaml = pytest.importorskip("yaml")
    found = settings(site_path, reference_path)
    path = site_path.parent / "site.yaml"
    path.write_text(yaml.safe_dump(found, allow_unicode=True), encoding="utf-8")
    assert fa.read_config(path) == fa.read_config(config_path)
    # Codes written as numbers, as YAML invites, are read as the strings JSON needs.
    found["variables"]["TA"]["qc_legend"] = {k: list(v) for k, v in FILL_LEGEND.items()}
    path.write_text(yaml.safe_dump(found, allow_unicode=True), encoding="utf-8")
    assert fa.read_config(path)["variables"]["TA"]["qc_legend"] == {
        k: list(v) for k, v in FILL_LEGEND.items()}


# -- What the file refuses ------------------------------------------------------------------------

@pytest.mark.parametrize("change, key, place", [
    (lambda s: s.update(sites="XX"), "sites", "the top level"),
    (lambda s: s["variables"]["TA"].update(colum="TA_F"), "colum", "variables.TA"),
    (lambda s: s["variables"]["TA"]["source"].update(legnd={}), "legnd", "variables.TA.source"),
    (lambda s: s["variables"]["TA"]["reference"].update(spilt=True), "spilt",
     "variables.TA.reference"),
    (lambda s: s["reference"].update(distance=2.0), "distance", "reference"),
    (lambda s: s["variables"]["TA"].update(instance="0.1"), "instance", "variables.TA"),
])
def test_an_unknown_key_is_refused_with_its_place(change, key, place, site_path, reference_path,
                                                  tmp_path):
    found = settings(site_path, reference_path)
    change(found)
    path = write_settings(tmp_path, found)
    with pytest.raises(ValueError, match=rf"site\.json, {re.escape(place)}: unknown key\(s\) "
                                         rf"'{key}'"):
        fa.read_config(path)


def test_the_file_is_refused_before_the_input_is_read(tmp_path):
    # The input does not exist, and the mistake is still the one reported.
    path = write_settings(tmp_path, {"input": "missing.csv", "first_yaer": 2005})
    with pytest.raises(ValueError, match="'first_yaer'"):
        fa.Atlas.from_config(path)
    with pytest.raises(SystemExit, match="--config: site.json, the top level: unknown key"):
        cli.main(["--config", str(path)])


def test_a_correction_check_cannot_be_stated_in_a_file(tmp_path):
    path = write_settings(tmp_path, {"variables": {"TA": {"column": "TA_SITE",
                                                          "checks": "my_module.check"}}})
    with pytest.raises(ValueError, match=r"variables\.TA\.checks: a correction check is a "
                                         r"Python callable"):
        fa.read_config(path)


@pytest.mark.parametrize("found, match", [
    ({"first_year": "2005"}, r"first_year: expected an integer"),
    ({"hourly": "no"}, r"hourly: expected true or false"),
    ({"lat": True}, r"lat: expected a number"),
    ({"seasons": "DJFMA"}, r"seasons: .*does not divide the year"),
    ({"variables": {"XX": "col"}}, r"variables: unknown variable 'XX'"),
    ({"variables": {"TA": {"qc_legend": {"x": "label"}}}},
     r"variables\.TA\.qc_legend: 'x' is not a flag code"),
    ({"variables": {"TA": {"source": {"legend": {}}}}}, r"variables\.TA\.source: names no column"),
    ({"variables": {"TA": {"notes": ["one", 2]}}}, r"variables\.TA\.notes\[1\]: expected a string"),
    ({"reference": {"station": "Syn"}}, r"reference: the reference station names no file"),
    (["TA"], r"holds one mapping of settings"),
])
def test_a_value_of_the_wrong_kind_is_refused_with_its_place(found, match, tmp_path):
    with pytest.raises(ValueError, match=match):
        fa.read_config(write_settings(tmp_path, found))


def test_a_file_that_is_not_json_or_does_not_exist(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text("{\"site\": ", encoding="utf-8")
    with pytest.raises(ValueError, match="broken.json is not valid JSON"):
        fa.read_config(path)
    with pytest.raises(FileNotFoundError):
        fa.read_config(tmp_path / "absent.json")


def test_the_checks_of_the_build_still_apply(site_path, tmp_path):
    path = write_settings(tmp_path, {"input": str(site_path), "variables": {"TA": "TA_F"},
                                     "primary": {"SWC": "SWC@0.3"}})
    with pytest.raises(KeyError, match="not among the variables"):
        fa.Atlas.from_config(path, quiet=True)
    path = write_settings(tmp_path, {"input": str(site_path), "variables": {
        "TA": {"column": "TA_F", "reference": "TA_REF"}}})
    with pytest.raises(ValueError, match="no reference station file"):
        fa.Atlas.from_config(path, quiet=True)


def test_an_input_has_to_come_from_somewhere(tmp_path):
    path = write_settings(tmp_path, {"site": "XX"})
    with pytest.raises(ValueError, match="names no input file"):
        fa.Atlas.from_config(path)
    with pytest.raises(SystemExit):
        cli.main(["--config", str(path)])
    with pytest.raises(SystemExit):
        cli.main([])


def test_write_needs_a_path_where_no_file_named_one(site_atlas):
    assert site_atlas.out is None
    with pytest.raises(ValueError, match="no output path"):
        site_atlas.write()


# -- The command line over the file ---------------------------------------------------------------

def merged(argv, config_path):
    """The mapping the command line builds over the file's, without building anything."""
    args = cli.build_parser().parse_args(["--config", str(config_path)] + argv)
    return cli.build_mapping(args, fa.read_config(config_path)["variables"]), args


def test_a_flag_replaces_the_field_it_names_and_keeps_the_rest(config_path):
    mapping, _ = merged(["--note", "TA=Replaced.", "--vars", "VPD", "--raw", "PA=PA_RAW",
                         "--var", "SWC@0.05=SWC_5B"], config_path)
    ta = mapping["TA"]
    assert ta["notes"] == ["Replaced."]
    assert ta["source"]["column"] == "TA_SITE_SOURCE" and ta["qc"] == "TA_SITE_FLAG"
    assert mapping["VPD"] is None
    assert mapping["PA"] == {"column": "PA_F", "reference": {"column": "PA_REF"},
                             "raw": "PA_RAW"}
    assert mapping["SWC@0.05"] == {"column": "SWC_5B", "title": "Soil water content at 0.05 m"}


def test_a_column_named_on_the_command_line_drops_the_flag_of_the_old_one(config_path):
    mapping, _ = merged(["--var", "TA=TA_F"], config_path)
    assert mapping["TA"]["column"] == "TA_F" and "qc" not in mapping["TA"]
    assert mapping["TA"]["raw"] == "TA_SITE_RAW"
    mapping, _ = merged(["--var", "TA=TA_F", "--qc", "TA=TA_F_QC"], config_path)
    assert mapping["TA"]["qc"] == "TA_F_QC"
    # The file's column can be refined without naming it again.
    mapping, _ = merged(["--factor", "PA=10"], config_path)
    assert mapping["PA"]["factor"] == 10.0 and mapping["PA"]["column"] == "PA_F"


def test_the_station_and_primary_flags_replace_what_they_name(config_path, tmp_path):
    found = fa.read_config(config_path)
    args = cli.build_parser().parse_args(["--config", str(config_path), "--ref-station", "Other",
                                          "--ref-shift", "0", "--primary", "TS=TS@0.1"])
    ref = cli.reference_of(args, found["reference"])
    assert ref == dict(found["reference"], station="Other", shift=0.0)
    assert cli.primary_of(args, found["primary"]) == {"SWC": "SWC@0.3", "TS": "TS@0.1"}
    args = cli.build_parser().parse_args(["--reference", str(tmp_path / "other.parquet")])
    assert cli.reference_of(args, found["reference"])["file"] == str(tmp_path / "other.parquet")
    assert cli.reference_of(cli.build_parser().parse_args([]), None) is None


def test_the_command_line_overrides_the_file(config_path, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "override.html"
    assert cli.main(["--config", str(config_path), "-q", "-o", str(out), "--site", "XX-Two",
                     "--first-year", "2014", "--note", "TA=Replaced in {units}.",
                     "--ref-station", "Other station", "--title", "Overridden"]) == 0
    html = out.read_text(encoding="utf-8")
    assert "<title>Overridden</title>" in html
    payload = page_payload(out)
    assert payload["meta"]["site"] == "XX-Two"
    assert payload["years"][0]["y"] == 2014
    ta = next(v for v in payload["variables"] if v["key"] == "TA")
    assert ta["notes"] == ["Replaced in °C."]
    assert ta["source"]["reference_from"] == "2015-01-08"
    assert payload["reference"]["station"] == "Other station"
    assert payload["meta"]["provenance"]["columns"]["TA"]["qc_legend"] == as_recorded(FILL_LEGEND)


def test_a_python_override_replaces_the_files_value_whole(config_path, tmp_path):
    atlas = fa.Atlas.from_config(config_path, variables={"TA": "TA_F"}, primary=None,
                                 reference=None, out=tmp_path / "plain.html", quiet=True)
    assert atlas.variables == ["TA"] and atlas.site == "XX-Syn"
    assert atlas.write(quiet=True) == tmp_path / "plain.html"
