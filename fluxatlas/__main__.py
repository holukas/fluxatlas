"""`python -m fluxatlas`, the same entry point as the installed `fluxatlas` command."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
