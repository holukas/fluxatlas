"""The renderer is kept as parts and shipped as one script.

`build.renderer_script` joins the files in `assets/js/` in the order `RENDERER_PARTS` states and
writes the one IIFE around them. These tests hold the three things that join depends on: every part
is listed and nothing else is, the parts are joined with nothing added or dropped, and the page
carries exactly the joined script.
"""

from __future__ import annotations

from fluxatlas import build


def test_every_part_is_listed_in_the_order_its_name_gives():
    """A part left out of the list would be silently missing from the page."""
    on_disk = sorted(p.name for p in build.RENDERER.glob("*.js"))
    assert list(build.RENDERER_PARTS) == on_disk


def test_no_part_carries_the_wrapper_or_a_broken_last_line():
    """The wrapper is written by the join; a part ending without a newline would merge two lines."""
    for name in build.RENDERER_PARTS:
        text = (build.RENDERER / name).read_text(encoding="utf-8")
        assert text.endswith("\n"), f"{name} does not end with a newline"
        assert build.RENDERER_OPEN not in text, f"{name} opens the wrapper itself"
        assert "\n" + build.RENDERER_CLOSE not in text, f"{name} closes the wrapper itself"


def test_joining_the_parts_reproduces_one_known_script(tmp_path):
    """In the stated order rather than the order of the folder, with nothing between the parts."""
    (tmp_path / "10-b.js").write_text("  const b = 2;\n\n", encoding="utf-8")
    (tmp_path / "00-a.js").write_text("/* header */\n  const a = 1;\n", encoding="utf-8")
    (tmp_path / "99-c.js").write_text("  go(a, b);\n", encoding="utf-8")
    script = build.renderer_script(tmp_path, ("00-a.js", "10-b.js", "99-c.js"))
    assert script == ("(function () {\n"
                      "  'use strict';\n"
                      "/* header */\n"
                      "  const a = 1;\n"
                      "  const b = 2;\n"
                      "\n"
                      "  go(a, b);\n"
                      "})();\n")


def test_the_page_carries_exactly_the_joined_script(full_atlas, tmp_path):
    html = full_atlas.write(tmp_path / "atlas.html", quiet=True).read_text(encoding="utf-8")
    start = html.index("<script>", html.index("id=\"payload\"") + 1)
    script = html[html.index(">", start) + 1:html.index("</script>", start)]
    assert script == "\n" + build.renderer_script() + "\n"
