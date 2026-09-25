"""What a page records about the file and the build that produced it.

A built page is mailed, archived and opened years later, apart from its input. FLUXNET files are
reprocessed under an unchanged name, so the name alone does not say which file a page was built
from; the size and the digest do, and the columns say which of a FULLSET file's variants each
figure came from.
"""

from __future__ import annotations

import hashlib
import json

import fluxatlas as fa
from fluxatlas import build, io


PROVENANCE_KEYS = {"file", "bytes", "sha256", "columns", "seasons", "first_year", "last_year",
                   "hourly"}


def test_the_provenance_has_the_agreed_shape(flux_atlas):
    """The renderer reads this object by these names, so the set of keys is a contract."""
    prov = flux_atlas.payload["meta"]["provenance"]
    assert set(prov) == PROVENANCE_KEYS
    for entry in prov["columns"].values():
        assert set(entry) == {"column", "qc", "factor"}
    json.dumps(prov, allow_nan=False)


def test_the_digest_is_the_sha256_of_the_whole_input_file(flux_atlas, flux_parquet_path):
    prov = flux_atlas.provenance
    data = flux_parquet_path.read_bytes()
    assert prov["sha256"] == hashlib.sha256(data).hexdigest()
    assert prov["bytes"] == len(data) == flux_parquet_path.stat().st_size
    assert prov["file"] == flux_parquet_path.name == flux_atlas.payload["meta"]["source"]


def test_the_digest_streams_rather_than_reading_the_file_whole(tmp_path):
    """A file several chunks long hashes to what hashing it in one piece gives."""
    path = tmp_path / "large.bin"
    data = bytes(range(256)) * 20_000        # about 5 MB, well past any single read
    path.write_bytes(data)
    assert fa.atlas._fingerprint(path) == dict(bytes=len(data),
                                               sha256=hashlib.sha256(data).hexdigest())


def test_the_columns_are_the_ones_the_tiles_name(flux_atlas):
    """Each variable's column is the one the page prints in the corner of its tiles."""
    prov = flux_atlas.provenance
    shown = {v["key"]: v["column"] for v in flux_atlas.payload["variables"]}
    assert {key: entry["column"] for key, entry in prov["columns"].items()} == shown
    assert list(prov["columns"]) == flux_atlas.variables
    for key, entry in prov["columns"].items():
        v = flux_atlas.loaded[key]["v"]
        assert entry["qc"] == v.qc_column
        assert entry["factor"] == v.factor


def test_the_columns_record_a_mapping_the_caller_gave(frame, tmp_path):
    """Named by hand, a column and its factor are recorded as given, and no flag as None."""
    path = tmp_path / "local.parquet"
    # No TA flag in the file at all, or the reader would find the registry's one beside it.
    local = frame.drop(columns=["TA_F_QC"]).rename(columns={"TA_F": "air_temp", "P_F": "rain_cm"})
    local.assign(rain_cm=local["rain_cm"] / 10).to_parquet(path)
    atlas = fa.Atlas(path, {"TA": {"column": "air_temp"},
                            "PREC": {"column": "rain_cm", "qc": "P_F_QC", "factor": 10.0}},
                     hourly=False, quiet=True, seasons="DJFMAM")
    prov = atlas.provenance
    assert prov["columns"]["TA"] == dict(column="air_temp", qc=None, factor=1.0)
    assert prov["columns"]["PREC"] == dict(column="rain_cm", qc="P_F_QC", factor=10.0)
    assert prov["seasons"] == "DJFMAM"
    assert prov["hourly"] is False


def test_the_build_settings_are_recorded(flux_atlas):
    prov = flux_atlas.provenance
    assert prov["seasons"] == build.DEFAULT_SEASONS
    assert (prov["first_year"], prov["last_year"]) == (flux_atlas.first_year,
                                                        flux_atlas.last_year)
    assert prov["hourly"] is False


def test_the_property_is_a_copy(flux_atlas):
    prov = flux_atlas.provenance
    prov["columns"]["NEE"]["column"] = "changed"
    assert flux_atlas.payload["meta"]["provenance"]["columns"]["NEE"]["column"] != "changed"


def test_the_digest_reaches_the_written_page(flux_atlas, tmp_path):
    html = flux_atlas.write(tmp_path / "atlas.html", quiet=True).read_text(encoding="utf-8")
    assert flux_atlas.provenance["sha256"] in html


def test_a_caller_of_build_payload_need_not_supply_a_fingerprint(parquet_path):
    """The fingerprint is optional; without it the file is still named and the rest recorded."""
    loaded = io.read_fluxnet(parquet_path, ["TA"], quiet=True)
    payload = build.build_payload(loaded, site="XX-Syn", site_long="", source="x.parquet",
                                  with_hourly=False, quiet=True)
    prov = payload["meta"]["provenance"]
    assert set(prov) == PROVENANCE_KEYS
    assert prov["file"] == "x.parquet"
    assert prov["bytes"] is None and prov["sha256"] is None
    assert prov["columns"]["TA"]["column"] == "TA_F"

