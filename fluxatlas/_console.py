"""Printing that survives a console whose code page cannot encode a unit.

Units carry superscripts and degree signs - `W m⁻²`, `°C` - and a build that has done its work must
not fail on printing one. The short fix is `sys.stdout.reconfigure(encoding="utf-8")`, which is a
reasonable thing for a script to do to itself and not a thing a library may do to its caller's
process. So the fallback is confined here, and every message the package prints goes through it.
"""

from __future__ import annotations

import sys


def say(text=""):
    """Print `text`, replacing whatever the console cannot encode."""
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or "ascii"
        print(text.encode(encoding, errors="replace").decode(encoding, errors="replace"))
