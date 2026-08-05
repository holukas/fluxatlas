"""What the distribution has to carry, checked from the installed package.

The page is assembled from files beside the code rather than from strings inside it, so a wheel that
built without `assets/` would install cleanly, import cleanly, and then write a page with no styles,
no renderer and no mark. Nothing else in the suite would notice: the tests read the assets from the
source tree, which is always there.
"""

from __future__ import annotations

import importlib.metadata
import re
from pathlib import Path

import pytest

import fluxatlas
from fluxatlas import build


def test_the_version_is_stated_once():
    """`__version__` is read from the installed distribution, so it cannot drift from pyproject."""
    assert fluxatlas.__version__ == importlib.metadata.version("fluxatlas")


def test_the_changelog_documents_the_version_being_shipped():
    """A release with no entry is a release nobody can read, and the entry is the release note."""
    changelog = (Path(build.__file__).parent.parent / "CHANGELOG.md")
    if not changelog.exists():
        pytest.skip("built from a wheel, without the repository beside it")
    heads = re.findall(r"^## v(\S+) \| (.+)$", changelog.read_text(encoding="utf-8"), re.M)
    assert heads, "the changelog has no version headings"
    assert heads[0][0] == fluxatlas.__version__, (
        f"the changelog opens with v{heads[0][0]} and the package is "
        f"{fluxatlas.__version__}")


def test_every_asset_the_page_needs_is_installed():
    """The five files `render` inlines, read from wherever the package actually is."""
    for name in ("template.html", "base.css", "calendar.css", "calendar.js", "logo.svg"):
        path = build.ASSETS / name
        assert path.exists(), f"{name} is missing from the installed package"
        assert path.stat().st_size > 0, f"{name} is installed but empty"


def test_the_template_still_wants_exactly_what_render_fills():
    """A placeholder renamed on one side of the render leaves it verbatim in the output."""
    template = (build.ASSETS / "template.html").read_text(encoding="utf-8")
    source = Path(build.__file__).read_text(encoding="utf-8")
    for placeholder in re.findall(r"__[A-Z]+__", template):
        assert placeholder in source, f"{placeholder} is in the template and not in render()"


def test_a_built_page_carries_no_unfilled_placeholder(full_atlas, tmp_path):
    html = full_atlas.write(tmp_path / "atlas.html", quiet=True).read_text(encoding="utf-8")
    left = set(re.findall(r"__[A-Z]+__", html))
    assert not left, f"the page still contains {', '.join(sorted(left))}"
