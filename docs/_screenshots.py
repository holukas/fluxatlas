"""Rebuild the page shown in the documentation and capture the screenshots from it.

The images in `docs/_static/screenshots/` are taken from the committed CH-LAE extract,
`examples/data/CH-LAE_meteo_30min_2005-2025.parquet`, built with the six-variable mapping of the
payload regression test, in the light theme and the Classic design. Run this after a change to the
page that the images would show:

    uv run --with playwright --with pillow python docs/_screenshots.py

Playwright and Pillow are not dependencies of the package; `--with` brings them in for this run
only. The browser is the Microsoft Edge installed on the machine (`--channel msedge`, the default),
so Playwright downloads no browser of its own. On a machine without Edge, `--channel chrome` uses an
installed Chrome, and `--channel chromium` the one `playwright install chromium` fetches.

The page is written to `docs/_build/screenshots/`, which is not committed; `--no-build` captures the
page the last run wrote, for adjusting a crop without rebuilding. The views captured are
listed in `VIEWS` below, each with the address it opens and the part of the page it keeps.
"""

import argparse
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import fluxatlas as fa  # noqa: E402
from tests.test_payload_regression import DATA, MAPPING  # noqa: E402

PAGE = ROOT / "docs" / "_build" / "screenshots" / "CH-LAE_atlas.html"
OUT = ROOT / "docs" / "_static" / "screenshots"

# Width of the browser window, in CSS pixels. The images are taken at a device scale of 1, so this
# is also their width before cropping.
WIDTH = 1280

# Each view: the file name, the address it opens, and the part of the page it keeps, from the top
# edge of one element to the bottom edge of another. An element is named by a selector and, where
# the selector matches several, the text its heading starts with. `height` caps the crop.
HEADING = "h2"
CARD = "section.card"

VIEWS = [
    dict(name="page-top", address="#grid",
         start=("header.topbar", None), end=("#view-grid", None), height=1040),
    dict(name="grid-top", address="#grid",
         start=("#s-grid", None), end=(".undergrid", None), height=1100),
    dict(name="grid", address="#grid",
         start=("#s-grid", None), end=(".undergrid", None)),
    dict(name="month", address="#2018-08",
         start=("header.topbar", None), end=("#view-month " + HEADING, "Badges and highlights"),
         end_edge="top"),
    dict(name="month-daily", address="#2018-08",
         start=("#view-month " + HEADING, "Daily series"),
         end=("#view-month " + CARD, "Cumulative precipitation")),
    dict(name="year", address="#2018-YEAR",
         start=("header.topbar", None), end=("#view-month " + CARD, "Rank of 2018 among")),
    dict(name="variable", address="#var-TA",
         start=("header.topbar", None), end=("#view-var " + CARD, "Summary,")),
    dict(name="variable-trends", address="#var-TA",
         start=("#view-var " + CARD, "Trends by calendar month"),
         end=("#view-var " + CARD, "Trends by calendar month")),
    dict(name="variable-anomaly", address="#var-TA",
         start=("#view-var " + CARD, "Monthly anomaly by year and month"),
         end=("#view-var " + CARD, "Monthly anomaly by year and month")),
]

# Space kept around the elements, in CSS pixels.
PAD = 14

# The page rectangle of the first visible element that matches, in page coordinates. A card is
# matched on its title, anything else on its own text.
BOX = """([selector, text]) => {
  const shown = [...document.querySelectorAll(selector)].filter(e => e.getClientRects().length);
  const label = e => (e.querySelector('h3.card-title') || e).textContent.trim();
  const hit = text ? shown.find(e => label(e).startsWith(text)) : shown[0];
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return {x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height};
}"""


def build():
    """The page, built from the committed extract exactly as the regression test builds it."""
    PAGE.parent.mkdir(parents=True, exist_ok=True)
    fa.Atlas(DATA, MAPPING, site="CH-LAE", quiet=True).write(PAGE)
    return PAGE


def clip_of(page, view):
    """The rectangle a view keeps, in page coordinates."""
    boxes = []
    for edge in ("start", "end"):
        box = page.evaluate(BOX, list(view[edge]))
        if box is None:
            raise SystemExit(f"{view['name']}: nothing on the page matches {view[edge]}")
        boxes.append(box)
    first, last = boxes
    top = first["y"] - PAD
    bottom = (last["y"] if view.get("end_edge") == "top" else last["y"] + last["height"]) + PAD
    if "height" in view:
        bottom = min(bottom, top + view["height"])
    # A card is kept at its own width; anything wider keeps the page's width.
    card = view["start"] == view["end"] and CARD in view["start"][0]
    left = first["x"] - PAD if card else 0
    width = first["width"] + 2 * PAD if card else WIDTH
    return dict(x=max(left, 0), y=max(top, 0), width=width, height=bottom - max(top, 0))


def save(png, path):
    """Write a screenshot as a palette PNG, which is a fraction of the size of a full-colour one."""
    from PIL import Image

    image = Image.open(io.BytesIO(png)).convert("RGB")
    image = image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    image.save(path, optimize=True)
    return path.stat().st_size


def capture(page_path, channel):
    from playwright.sync_api import sync_playwright

    OUT.mkdir(parents=True, exist_ok=True)
    url = page_path.resolve().as_uri()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=None if channel == "chromium" else channel)
        # A fresh context has no stored theme or design, so the page opens in Classic, and the
        # light colour scheme resolves its `auto` theme to light.
        context = browser.new_context(viewport=dict(width=WIDTH, height=1000),
                                      device_scale_factor=1, color_scheme="light")
        errors = []
        for view in VIEWS:
            name, address = view["name"], view["address"]
            # Every view is opened on a page of its own, so none inherits the scroll position or
            # the state the one before it left behind.
            page = context.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(url + address)
            page.wait_for_load_state("load")
            page.mouse.move(0, 0)
            page.wait_for_timeout(600)
            clip = clip_of(page, view)
            page.mouse.move(0, 0)
            page.wait_for_timeout(200)
            png = page.screenshot(clip=clip, full_page=True, animations="disabled")
            size = save(png, OUT / f"{name}.png")
            print(f"  {name + '.png':24s} {address:12s} {int(clip['width'])} x {int(clip['height'])}"
                  f"  {size / 1024:.0f} KB")
            page.close()
        browser.close()
    if errors:
        raise SystemExit("the page threw while it was captured:\n  " + "\n  ".join(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--channel", default="msedge",
                        help="browser for Playwright: msedge (default), chrome or chromium")
    parser.add_argument("--no-build", action="store_true",
                        help="capture the page the last run built, without rebuilding it")
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    if args.no_build and PAGE.exists():
        page = PAGE
    else:
        print(f"building {PAGE.relative_to(ROOT)} from {DATA.name}")
        page = build()
    print(f"capturing into {OUT.relative_to(ROOT)}")
    capture(page, args.channel)


if __name__ == "__main__":
    main()
