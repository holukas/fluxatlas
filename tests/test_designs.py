"""The design switch: three alternative looks beside the page's own, chosen in the top bar.

A design is a token set for light and for dark plus some typography, applied by an attribute on
<html>. Two things can go quietly wrong and neither shows in any test that reads text: a token set
in a design's light block and missing from its dark block shows its light value in dark mode, and
a colour token written as anything but six-digit hex breaks the ramps the grid and the canvas
parse. The rest is driven in jsdom: choosing a design repaints the tiles, is remembered, and
survives the light/dark toggle.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from fluxatlas import build

DESIGNS = ("journal", "observatory", "swiss")
# Comments stripped, so a selector is read without the comment in front of it.
CSS = re.sub(r"/\*.*?\*/", "", (build.ASSETS / "designs.css").read_text(encoding="utf-8"),
             flags=re.S)
BASE = (build.ASSETS / "base.css").read_text(encoding="utf-8")
DRIVER = Path(__file__).parent / "design_switch.mjs"
NODE = shutil.which("node")
JSDOM = (Path(__file__).parent / "js" / "node_modules" / "jsdom").is_dir()
needs_jsdom = pytest.mark.skipif(NODE is None or not JSDOM,
                                 reason="node with jsdom is not available; run `npm install` in "
                                        "tests/js")

COLOUR = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\(.*\))$")
HEX6 = re.compile(r"^#[0-9a-f]{6}$")


def block(selector_pattern):
    """The declarations of the one rule whose selector matches, as {token: value}."""
    found = [m for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS)
             if re.fullmatch(selector_pattern, m.group(1).strip())]
    assert len(found) == 1, f"{selector_pattern!r} matched {len(found)} rules"
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", found[0].group(2)))


def blocks(name):
    light = block(rf':root\[data-design="{name}"\]')
    dark = block(rf':root\[data-design="{name}"\]\[data-theme="dark"\]')
    auto = block(rf':root\[data-design="{name}"\]:where\(\[data-theme="auto"\]\)')
    return light, dark, auto


def parsed_tokens():
    """The tokens base.css gives a hex value - the ones a ramp or the canvas may parse."""
    root = re.search(r":root\s*\{([^}]*)\}", BASE).group(1)
    return {k for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", root)
            if v.strip().startswith("#")}


@pytest.mark.parametrize("name", DESIGNS)
def test_each_dark_set_restates_every_colour_its_light_set_sets(name):
    light, dark, auto = blocks(name)
    colours = {k for k, v in light.items() if COLOUR.match(v.strip())}
    assert colours, f"{name} sets no colours"
    assert not colours - set(dark), f"{name} dark lacks {sorted(colours - set(dark))}"
    assert not colours - set(auto), f"{name} auto-dark lacks {sorted(colours - set(auto))}"
    assert dark == auto, f"{name}: the toggle's dark set and the system's dark set differ"


@pytest.mark.parametrize("name", DESIGNS)
def test_every_token_a_ramp_may_parse_is_six_digit_hex(name):
    for which in blocks(name):
        for token in parsed_tokens() & set(which):
            assert HEX6.match(which[token].strip()), f"{name} {token} = {which[token]}"


@pytest.mark.parametrize("name", DESIGNS)
def test_each_design_sets_every_series_and_ramp_token(name):
    """A design that left a ramp stop to the base set would mix two palettes on one grid."""
    wanted = {t for t in parsed_tokens()
              if re.match(r"--(series|pole|neutral|seq|cold|warm|band)-", t)}
    for which in blocks(name):
        assert not wanted - set(which), f"{name} lacks {sorted(wanted - set(which))}"


def test_the_switch_offers_classic_and_every_design():
    template = (build.ASSETS / "template.html").read_text(encoding="utf-8")
    offered = re.findall(r'<option value="(\w+)"', template)
    assert offered == ["classic", *DESIGNS]
    assert "design-select" in template


def test_the_page_carries_the_designs(full_atlas, tmp_path):
    html = full_atlas.write(tmp_path / "atlas.html", quiet=True).read_text(encoding="utf-8")
    for name in DESIGNS:
        assert f'[data-design="{name}"]' in html


# -- The switch, driven ----------------------------------------------------------------------------

def drive(page, stored=None):
    result = subprocess.run([NODE, str(DRIVER), str(page), *([stored] if stored else [])],
                            capture_output=True, text=True, encoding="utf-8", timeout=300)
    assert result.returncode == 0, result.stderr
    found = json.loads(result.stdout)
    assert not found["errors"], found["errors"]
    return found


@pytest.fixture(scope="module")
def page(full_atlas, tmp_path_factory):
    return full_atlas.write(tmp_path_factory.mktemp("designs") / "atlas.html", quiet=True)


@needs_jsdom
def test_choosing_a_design_repaints_the_page_in_its_tokens(page):
    found = drive(page)
    assert found["options"] == ["classic", *DESIGNS]
    assert found["initial"]["attr"] is None and found["initial"]["value"] == "classic"
    classic = found["designs"]["classic"]
    assert classic["attr"] is None and classic["stored"] == "classic"
    for name in DESIGNS:
        row = found["designs"][name]
        light, dark, _ = blocks(name)
        assert row["attr"] == name and row["stored"] == name
        assert row["tokens"]["--pole-warm"] == light["--pole-warm"].strip()
        assert row["cell"] and row["cell"] != classic["cell"], f"{name} did not repaint the tiles"
        assert row["text"] > 0
        # Under the design, the toggle switches to the design's own dark set.
        assert row["dark"]["theme"] == "dark"
        assert row["dark"]["tokens"]["--page"] == dark["--page"].strip()
        assert row["dark"]["cell"] != row["cell"]


@needs_jsdom
def test_a_remembered_design_is_in_force_before_the_first_paint(page):
    found = drive(page, stored="swiss")
    assert found["initial"]["attr"] == "swiss" and found["initial"]["value"] == "swiss"
    # The first tiles are already in the design's colours, not repainted into them later.
    assert found["initial"]["cell"] == found["designs"]["swiss"]["cell"]


@needs_jsdom
def test_an_unknown_remembered_design_falls_back_to_classic(page):
    found = drive(page, stored="baroque")
    assert found["initial"]["attr"] is None and found["initial"]["value"] == "classic"
