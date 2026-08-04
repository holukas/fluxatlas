"""The bundled CH-LAE extract, and the example that builds an atlas from it.

These skip where the extract is absent, so a checkout without it still has a passing suite. They
are the only tests that touch real data, and what they check is the things synthetic data cannot:
that the example's column mapping still matches the file, and that a real twenty-one-year record
with real gaps produces a page.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

import fluxatlas as fa

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"
DATA = EXAMPLES / "data" / "CH-LAE_meteo_30min_2005-2025.parquet"

pytestmark = pytest.mark.skipif(not DATA.exists(),
                                reason=f"bundled example data not present at {DATA}")


@pytest.fixture(scope="module")
def mapping():
    """The example's own mapping, imported rather than restated so the two cannot drift."""
    sys.path.insert(0, str(EXAMPLES))
    try:
        from build_lae_meteo_atlas import MAPPING
    finally:
        sys.path.pop(0)
    return MAPPING


def test_the_extract_has_the_shape_the_example_expects():
    df = pd.read_parquet(DATA)
    assert isinstance(df.index, pd.DatetimeIndex)
    assert df.index.name == "TIMESTAMP_MIDDLE"
    assert (df.index.to_series().diff().dropna() == pd.Timedelta("30min")).all()
    assert df.index[0].year == 2005 and df.index[-1].year == 2025


def test_the_examples_mapping_still_matches_the_file(mapping):
    df = pd.read_parquet(DATA)
    for key, spec in mapping.items():
        assert spec["column"] in df.columns, f"{key}: {spec['column']} is gone from the extract"
        if spec.get("qc"):
            assert spec["qc"] in df.columns, f"{key}: {spec['qc']} is gone from the extract"


def test_a_real_record_builds_an_atlas(mapping, tmp_path):
    atlas = fa.Atlas(DATA, mapping, site="CH-LAE", hourly=False, quiet=True)
    assert (atlas.first_year, atlas.last_year) == (2005, 2025)
    assert len(atlas.payload["months"]) == 21 * 12
    assert len(atlas.metrics) > 12
    out = atlas.write(tmp_path / "atlas.html", quiet=True)
    assert out.stat().st_size > 500_000


def test_the_real_record_warms(mapping):
    """CH-LAE warms over 2005-2025; an atlas that reported no trend would be suspect."""
    atlas = fa.Atlas(DATA, {"TA": mapping["TA"]}, site="CH-LAE", hourly=False, quiet=True)
    ta = next(m for m in atlas.payload["metrics"] if m["key"] == "TA")
    assert ta["trend_year"]["slope"] > 0


def test_one_variable_out_of_the_real_file_is_smaller_but_whole(mapping, tmp_path):
    full = fa.Atlas(DATA, mapping, site="CH-LAE", hourly=False, quiet=True)
    one = fa.Atlas(DATA, {"TA": mapping["TA"]}, site="CH-LAE", hourly=False, quiet=True)
    assert len(one.metrics) < len(full.metrics)
    assert len(one.payload["months"]) == len(full.payload["months"])
    assert one.write(tmp_path / "one.html", quiet=True).stat().st_size > 100_000
