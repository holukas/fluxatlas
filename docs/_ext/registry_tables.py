"""Directives that render the variable registry into the documentation.

The registry is the one place that knows a variable's unit, how it aggregates, which columns can
supply it and which uncertainty components it carries. Writing any of that out a second time in the
documentation would let the two drift, and a page that states the wrong unit is worse than one that
states nothing. So the tables are generated from `fluxatlas.variables` at build time:

    .. fluxatlas-variables::
    .. fluxatlas-columns:: TA
    .. fluxatlas-uncertainty::

A change to the registry changes the built page, and nothing has to be remembered.
"""

from __future__ import annotations

from docutils import nodes
from docutils.parsers.rst import Directive, directives
from docutils.statemachine import StringList

from fluxatlas import variables as varreg

AGGREGATION = {"mean": "mean", "sum": "total"}

FAMILY = {varreg.METEOROLOGY: "Meteorology", varreg.FLUX: "Flux"}

KIND_RULE = {
    varreg.QUADRATURE: "quadrature, ``sqrt(sum of squares)``",
    varreg.SYSTEMATIC: "systematic, summed linearly",
    varreg.ENSEMBLE: "ensemble, half the spread of the aggregated members",
}


def _table(directive, rows, header, widths=None):
    """A generated `list-table` parsed in place, so it themes like a written one."""
    lines = [".. list-table::", "   :header-rows: 1"]
    if widths:
        lines.append(f"   :widths: {' '.join(str(w) for w in widths)}")
    lines.append("")
    for row in [header] + rows:
        cells = list(row)
        lines.append(f"   * - {cells[0]}")
        lines.extend(f"     - {cell}" for cell in cells[1:])
    lines.append("")

    node = nodes.section()
    node.document = directive.state.document
    directive.state.nested_parse(StringList(lines, source=""), directive.content_offset, node)
    return node.children


def _keys(argument):
    """The keys a directive was given, or every key in registry order."""
    if not argument:
        return varreg.known()
    wanted = [k.strip() for k in argument.replace(",", " ").split() if k.strip()]
    unknown = [k for k in wanted if k not in varreg.VARIABLES]
    if unknown:
        raise ValueError(f"unknown variable(s) {', '.join(unknown)}")
    return wanted


class VariableTable(Directive):
    """One row per canonical variable: what it is, in what unit, and how a span is summarised."""

    has_content = False
    optional_arguments = 1
    final_argument_whitespace = True
    option_spec = {"family": directives.unchanged}

    def run(self):
        keys = _keys(self.arguments[0] if self.arguments else "")
        family = self.options.get("family")
        if family:
            keys = [k for k in keys if varreg.family(k) == family]

        rows = []
        for key in keys:
            v = varreg.make(key)
            rows.append([
                f"``{key}``",
                v.title,
                v.units,
                AGGREGATION.get(v.agg, v.agg),
                f"{v.coverage.warn:g} %",
            ])
        header = ["Key", "Variable", "Unit", "A span is its", "Warns under"]
        return _table(self, rows, header, widths=[8, 26, 10, 12, 10])


class ColumnTable(Directive):
    """The candidate columns for a variable, in the order they are resolved."""

    has_content = False
    optional_arguments = 1
    final_argument_whitespace = True

    def run(self):
        rows = []
        for key in _keys(self.arguments[0] if self.arguments else ""):
            v = varreg.make(key)
            columns = ", ".join(
                f"``{name}``" + ("" if factor == 1.0 else f" (×{factor:g})")
                for name, factor in v.candidates)
            flags = ", ".join(f"``{q}``" for q in v.qc_candidates) or "—"
            rows.append([f"``{key}``", columns, flags])
        header = ["Key", "Columns, in preference order", "Quality flags"]
        return _table(self, rows, header, widths=[8, 34, 20])


class UncertaintyTable(Directive):
    """Which uncertainty components each variable carries, and how each aggregates."""

    has_content = False
    optional_arguments = 1
    final_argument_whitespace = True

    def run(self):
        rows = []
        for key in _keys(self.arguments[0] if self.arguments else ""):
            for spec in varreg.VARIABLES[key].get("uncertainty", []):
                if spec["kind"] == varreg.ENSEMBLE:
                    members = spec["members"][0]
                    columns = f"``{members[0]}`` … ``{members[-1]}``"
                else:
                    columns = ", ".join(f"``{c}``" for c in spec["columns"])
                rows.append([f"``{key}``", spec["label"], columns, KIND_RULE[spec["kind"]]])
        header = ["Key", "Component", "Columns", "Aggregated as"]
        return _table(self, rows, header, widths=[8, 14, 30, 26])


class AboutList(Directive):
    """Each variable's own description, as the registry states it."""

    has_content = False
    optional_arguments = 1
    final_argument_whitespace = True

    def run(self):
        lines = []
        for key in _keys(self.arguments[0] if self.arguments else ""):
            v = varreg.make(key)
            lines.append(f"``{key}`` — {v.title} [{v.units}]")
            lines.append(f"   {v.fmt(v.about)}")
            lines.append("")

        node = nodes.section()
        node.document = self.state.document
        self.state.nested_parse(StringList(lines, source=""), self.content_offset, node)
        return node.children


def setup(app):
    app.add_directive("fluxatlas-variables", VariableTable)
    app.add_directive("fluxatlas-about", AboutList)
    app.add_directive("fluxatlas-columns", ColumnTable)
    app.add_directive("fluxatlas-uncertainty", UncertaintyTable)
    return {"parallel_read_safe": True, "parallel_write_safe": True}
