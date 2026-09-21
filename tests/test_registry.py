"""The registry's checks on its own data, and that optimisation cannot remove them.

`Variable.__init__` validates three registry facts: which end of the distribution takes rank 1, that
an index group fits the steps its ramp has, and that every index reads a daily statistic the
variable actually computes. None of the three is an internal invariant that can only fail through a
bug in this module - each is a statement about a registry entry, which is data, and data is what
gets edited.

They were `assert` statements, and `assert` is stripped by `python -O`. Under optimisation a page
built from a broken entry would be silently wrong rather than refused: the ranking running the
opposite way, or an index reaching for a statistic no day carries. So they raise `ValueError`, and
the last test here is the one the change exists for - it starts an optimised interpreter and asserts
the check still fires.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from fluxatlas import variables as varreg


def entry(**overrides):
    """A minimal registry entry, so a test states only the field it is about."""
    cfg = dict(title="Test variable", units="°C", columns=[("TEST", 1.0)], limits=(-10.0, 10.0),
               about="A registry entry that exists to be checked.")
    cfg.update(overrides)
    return cfg


# -- The checks fire, and say what is wrong ------------------------------------------------------

def test_a_rank_first_that_is_neither_end_is_refused():
    with pytest.raises(ValueError, match=r"TEST: rank_first must be 'high' or 'low'"):
        varreg.Variable("TEST", entry(rank_first="lowest"))


def test_an_index_group_wider_than_its_ramp_is_refused():
    """Two indices is what the cold ramp has steps for; a third would repeat a hue."""
    group = dict(title="Cold indices", ramp="cold",
                 items=[dict(key=f"k{i}", label=f"index {i}", stat="min", op="lt", value=float(i))
                        for i in range(3)])
    with pytest.raises(ValueError) as excinfo:
        varreg.Variable("TEST", entry(index_groups=[group]))
    message = str(excinfo.value)
    assert "TEST: index group 'Cold indices' has 3 indices" in message
    assert "the cold ramp has 2 steps" in message
    assert "split the group or add a ramp" in message


def test_an_index_reading_a_statistic_the_variable_does_not_compute_is_refused():
    group = dict(title="Wet-day counts", ramp="cold",
                 items=[dict(key="wet", label="wet days", stat="sum", op="ge", value=1.0)])
    with pytest.raises(ValueError) as excinfo:
        varreg.Variable("TEST", entry(agg="mean", daily_stats=("min", "mean", "max"),
                                      index_groups=[group]))
    message = str(excinfo.value)
    assert "TEST: index 'wet' needs the daily sum" in message
    assert "daily_stats ('min', 'mean', 'max')" in message


def test_the_registry_as_shipped_passes_its_own_checks():
    """The checks are worth nothing if no build ever runs them over the real entries."""
    for key in varreg.known():
        varreg.make(key)


# -- And they survive `-O`, which is the point of them not being asserts -------------------------

# Written out rather than imported from this module, because the subprocess has only the package
# on its path - the test tree is not importable from outside pytest.
PROGRAM = """
import sys
sys.path.insert(0, {root!r})
from fluxatlas import variables as varreg

cfg = dict(title="Test variable", units="C", columns=[("TEST", 1.0)], limits=(-10.0, 10.0),
           about="A registry entry that exists to be checked.")
cfg.update({overrides})
try:
    varreg.Variable("TEST", cfg)
except ValueError as exc:
    print(exc)
    sys.exit(3)
sys.exit(0)
"""

CHECKS = {
    "rank_first": "dict(rank_first='lowest')",
    "ramp steps": ("dict(index_groups=[dict(title='G', ramp='cold', items=["
                   "dict(key='a', label='a', stat='min', op='lt', value=0.0), "
                   "dict(key='b', label='b', stat='min', op='lt', value=1.0), "
                   "dict(key='c', label='c', stat='min', op='lt', value=2.0)])])"),
    "index stat": ("dict(agg='mean', daily_stats=('min', 'mean', 'max'), "
                   "index_groups=[dict(title='G', ramp='cold', items=["
                   "dict(key='wet', label='wet', stat='sum', op='ge', value=1.0)])])"),
}


@pytest.mark.parametrize("name, overrides", sorted(CHECKS.items()))
def test_every_registry_check_still_fires_under_optimisation(name, overrides):
    """`python -O` strips `assert`, so a check written as one would let the bad entry through."""
    root = str(Path(varreg.__file__).resolve().parent.parent)
    source = PROGRAM.format(root=root, overrides=overrides)
    done = subprocess.run([sys.executable, "-O", "-c", source], capture_output=True, text=True)
    assert done.returncode == 3, (
        f"the {name} check did not fire under -O; stdout={done.stdout!r} stderr={done.stderr!r}")
    assert "TEST" in done.stdout, f"the {name} message no longer names the key: {done.stdout!r}"


def test_the_optimised_interpreter_really_does_strip_assert():
    """Guards the test above: if `-O` were not in force, it would pass without proving anything."""
    done = subprocess.run([sys.executable, "-O", "-c", "assert False; print('stripped')"],
                          capture_output=True, text=True)
    assert done.returncode == 0 and "stripped" in done.stdout
