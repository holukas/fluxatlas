"""A build that uses none of the optional configuration produces the payload it always did.

The variable-level options - a source flag, a fill legend, instances of one variable, a measured twin,
a reference station, site notes - are opt-in. A build that names none of them has to come out
exactly as it did before they existed, so that a page someone already cites does not move under them.
This builds the bundled CH-LAE extract with a mapping frozen here, not imported from the example,
and compares the payload with one written before the options were added.

The comparison is exact for everything but two fields: the build time, and the package version,
which moves at every release without anything on the page changing. The hourly layer is most of the
payload and is integers throughout, so it is compared by digest rather than stored.

Additions are declared rather than tolerated. `ADDED` names the top-level keys a later build may
carry that the baseline does not, and nothing else may appear or disappear. A key added on purpose
is added there, with a line saying what it is.

To rewrite the baseline after a change that is meant to move the payload:

    uv run python tests/test_payload_regression.py --write
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import sys
from pathlib import Path

import pytest

import fluxatlas as fa

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "examples" / "data" / "CH-LAE_meteo_30min_2005-2025.parquet"
BASELINE = Path(__file__).resolve().parent / "data" / "payload_baseline.json.gz"

# The six-variable mapping the CH-LAE example used when the baseline was written. Frozen here: the
# example has since moved to the merged product and its options, which is exactly what this build
# must not use.
MAPPING = {
    "TA": dict(column="TA_T1_47_1_HOMOGENIZED_gfXG", qc="FLAG_TA_T1_47_1_ISFILLED"),
    "PREC": dict(column="PREC_TOT_T1_47_1_HOMOGENIZED", qc="FLAG_PREC_TOT_T1_47_1_ISFILLED"),
    "SW_IN": dict(column="SW_IN_T1_47_1_gfXG", qc="FLAG_SW_IN_T1_47_1_ISFILLED"),
    "VPD": dict(column="VPD_T1_47_1", qc="FLAG_VPD_T1_47_1_ISFILLED"),
    "RH": dict(column="RH_T1_47_1"),
    "SWC": dict(column="SWC_FF1_0.2_1_HOMOGENIZED"),
}

# Top-level payload keys added after the baseline was written, each for a reason. Their content is
# tested where they are built; here they are only allowed to exist.
ADDED = {
    # The figures behind the variable page's year-by-year cards: percentiles of the half-hours,
    # measured extremes, new records, the longest gap and the gap-fill check.
    "var_record",
}

# Fields that change without the page changing.
VOLATILE = (("meta", "generated"), ("meta", "version"))


def build():
    atlas = fa.Atlas(DATA, MAPPING, site="CH-LAE", quiet=True)
    return atlas.payload


def normalised(payload):
    """The payload as plain JSON data, with the volatile fields removed and the hourly layer hashed."""
    data = json.loads(json.dumps(payload, allow_nan=False))
    for outer, inner in VOLATILE:
        data.get(outer, {}).pop(inner, None)
    hourly = data.pop("hourly", None)
    data["hourly_sha256"] = hashlib.sha256(
        json.dumps(hourly, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return data


def differences(old, new, path="payload", out=None, limit=20):
    """Where two JSON values differ, as readable paths, up to `limit` of them."""
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(set(old) | set(new), key=str):
            if key not in new:
                out.append(f"{path}.{key}: missing from the new payload")
            elif key not in old:
                out.append(f"{path}.{key}: not in the baseline")
            else:
                differences(old[key], new[key], f"{path}.{key}", out, limit)
    elif isinstance(old, list) and isinstance(new, list):
        if len(old) != len(new):
            out.append(f"{path}: length {len(old)} became {len(new)}")
        for i, (a, b) in enumerate(zip(old, new)):
            differences(a, b, f"{path}[{i}]", out, limit)
    elif isinstance(old, float) and isinstance(new, (int, float)) and not isinstance(new, bool):
        if not math.isclose(old, new, rel_tol=1e-12, abs_tol=1e-12):
            out.append(f"{path}: {old!r} became {new!r}")
    elif old != new or type(old) is not type(new):
        out.append(f"{path}: {old!r} became {new!r}")
    return out


@pytest.mark.skipif(not DATA.exists(), reason=f"bundled example data not present at {DATA}")
@pytest.mark.skipif(not BASELINE.exists(), reason="no payload baseline has been written")
def test_a_build_without_the_new_options_is_unchanged():
    old = json.loads(gzip.decompress(BASELINE.read_bytes()))
    new = normalised(build())
    unexpected = set(new) - set(old) - ADDED
    assert not unexpected, f"top-level keys not in the baseline and not declared: {unexpected}"
    for key in ADDED:
        new.pop(key, None)
    found = differences(old, new)
    assert not found, "the payload moved:\n  " + "\n  ".join(found)


if __name__ == "__main__":
    if "--write" not in sys.argv:
        raise SystemExit("pass --write to rewrite the baseline")
    BASELINE.parent.mkdir(exist_ok=True)
    data = normalised(build())
    for key in ADDED:
        data.pop(key, None)
    BASELINE.write_bytes(gzip.compress(json.dumps(data, separators=(",", ":")).encode(), mtime=0))
    print(f"written: {BASELINE} ({BASELINE.stat().st_size / 1024:.0f} kB)")
