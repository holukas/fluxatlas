"""
fluxatlas: interactive explorer for FLUXNET-standardized ecosystem data
=======================================================================

Builds a standalone, browsable page from the half-hourly FLUXNET-standardized output of an eddy
covariance site: every month of the record on one grid, drilling down to the season, the month and
the single day.

    import fluxatlas as fa

    fa.available("CH-LAE_HH_2004-2025.csv")
    fa.build_atlas("CH-LAE_HH_2004-2025.csv", "atlas.html", variables=["TA", "PREC"])

The atlas is built for exactly the variables asked for: the meteorology, the turbulent fluxes, or
any selection of either.
"""

from importlib.metadata import PackageNotFoundError, version

from .atlas import Atlas, available, build_atlas, known_variables
from .variables import VARIABLES

# Read from the installed distribution rather than written a second time, so a bump in
# `pyproject.toml` is the only place a version is stated. The fallback is for a source tree that
# was never installed, which is the one case the metadata cannot answer.
try:
    __version__ = version("fluxatlas")
except PackageNotFoundError:
    __version__ = "0.1.0"

__all__ = ["Atlas", "build_atlas", "available", "known_variables", "VARIABLES", "__version__"]
