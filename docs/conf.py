"""Sphinx configuration.

The documentation is Markdown (MyST) throughout, matching the README and the notes in the
repository, with two generated parts: the API reference comes from the docstrings, and the variable
tables come from the registry itself through the local `registry_tables` extension.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The package, for autodoc and for the registry tables. Read the Docs installs it, so this only
# matters for a build from a checkout that has not.
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent / "_ext"))

from fluxatlas import __version__ as fluxatlas_version  # noqa: E402

project = "fluxatlas"
author = "Lukas Hörtnagl"
copyright = "2026, Lukas Hörtnagl, Grassland Sciences group, ETH Zürich"
version = fluxatlas_version
release = fluxatlas_version

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.autosummary",
    "sphinx.ext.intersphinx",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx_autodoc_typehints",
    "sphinx_copybutton",
    "sphinxarg.ext",
    "myst_parser",
    "registry_tables",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]
language = "en"

# HTML output
html_theme = "furo"
html_title = f"fluxatlas {version}"
html_static_path = ["_static"]
html_css_files = ["custom.css"]
# The package's own mark, taken from the package rather than copied into `_static`, so the two
# cannot drift apart.
html_logo = "../fluxatlas/assets/logo.svg"
html_favicon = "../fluxatlas/assets/logo.svg"
html_theme_options = {
    # The name is drawn by `_templates/sidebar/brand.html`, which sets it beside the mark.
    "sidebar_hide_name": True,
    "source_repository": "https://github.com/holukas/fluxatlas/",
    "source_branch": "main",
    "source_directory": "docs/",
    # The page's own ramp: the cold end of the anomaly grid in light, the warm end in dark.
    "light_css_variables": {
        "color-brand-primary": "#2b6a8f",
        "color-brand-content": "#2b6a8f",
    },
    "dark_css_variables": {
        "color-brand-primary": "#8fc4de",
        "color-brand-content": "#8fc4de",
    },
}

# Autodoc. Members in source order, because these modules are written to be read top to bottom.
autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "undoc-members": False,
    "show-inheritance": True,
}
autodoc_typehints = "description"
autodoc_typehints_format = "short"
autosummary_generate = False

# The package is untyped, so there is nothing for the typehints extension to resolve and its
# warnings would be noise under `fail_on_warning`.
always_document_param_types = False
typehints_document_rtype = False

intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
    "numpy": ("https://numpy.org/doc/stable", None),
    "pandas": ("https://pandas.pydata.org/docs", None),
    "scipy": ("https://docs.scipy.org/doc/scipy", None),
}

myst_enable_extensions = ["colon_fence", "deflist", "substitution", "attrs_inline"]
myst_heading_anchors = 3

source_suffix = {".rst": "restructuredtext", ".md": "markdown"}

copybutton_prompt_text = r">>> |\.\.\. |\$ "
copybutton_prompt_is_regexp = True

# The units on these pages are heavy in characters pdflatex cannot set - `W m⁻²`, `µmol`, `°C` -
# so a PDF build uses the engine that can.
latex_engine = "xelatex"


# `sphinx-argparse` declares itself safe to read in parallel and registers a domain that does not
# implement `merge_domaindata`, so Sphinx splits the read across workers and then dies merging what
# they produced. Read the Docs builds with `-j auto`, so this is not hypothetical.
#
# Saying the extension is unsafe instead only moves the failure: Sphinx then warns that it is
# unsafe and that it is reading serially, and both Read the Docs and the CI job build with `-W`,
# which turns those two warnings into the error that fails the build. The warnings carry no type,
# so `suppress_warnings` cannot reach them either.
#
# So the method is supplied. The domain keeps two collections, and every entry in both is a tuple
# whose fourth element is the document it came from, which is exactly what a merge needs: take the
# entries belonging to the documents this worker read, and leave the rest.
#
# None of this is visible from a Windows checkout. Parallel reading needs `os.fork`, so
# `sphinx.util.parallel.parallel_available` is False there and a local build is serial whatever it
# is asked for. The CI job builds with `-j auto` on Linux for that reason.
#
# Remove all of it once the extension implements the method itself.
def _merge_argparse_domaindata(self, docnames, otherdata):
    docnames = set(docnames)
    for entry in otherdata.get("commands", ()):
        if entry[3] in docnames:
            self.data["commands"].append(entry)
    for group, entries in otherdata.get("commands-by-group", {}).items():
        kept = [entry for entry in entries if entry[3] in docnames]
        if kept:
            self.data["commands-by-group"].setdefault(group, []).extend(kept)


def setup(app):
    from sphinx.domains import Domain
    from sphinxarg.ext import ArgParseDomain

    # Only where the extension still inherits the base class's `raise NotImplementedError`, so a
    # released fix upstream wins over this one rather than being shadowed by it.
    if ArgParseDomain.merge_domaindata is Domain.merge_domaindata:
        ArgParseDomain.merge_domaindata = _merge_argparse_domaindata
