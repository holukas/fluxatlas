"""Parse the renderer, where a parser exists.

The renderer is one IIFE, so a syntax error anywhere in it blanks the whole page: the markup loads,
nothing draws, and no error reaches a reader. A stray `;` inside a string literal did exactly that
while every other test passed, which is why the repository's own notes say to open the built page
after touching `calendar.js`.

Node is not a dependency of this package and is not on every machine, so this test skips where it is
absent. Where it is present it is the cheapest guard there is: `node --check` parses the file and
says nothing more.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest

from fluxatlas import build

NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node is not installed; open the built page instead")
def test_the_renderer_parses():
    result = subprocess.run([NODE, "--check", str(build.ASSETS / "calendar.js")],
                            capture_output=True, text=True)
    assert result.returncode == 0, f"calendar.js does not parse:\n{result.stderr}"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_page_as_built_parses(full_atlas, tmp_path):
    """The inlined copy, which is what a reader actually loads."""
    html = full_atlas.write(tmp_path / "atlas.html", quiet=True).read_text(encoding="utf-8")
    start = html.index("<script>", html.index("id=\"payload\"") + 1)
    script = html[html.index(">", start) + 1:html.index("</script>", start)]
    path = tmp_path / "inlined.js"
    path.write_text(script, encoding="utf-8")
    result = subprocess.run([NODE, "--check", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, f"the inlined renderer does not parse:\n{result.stderr}"
