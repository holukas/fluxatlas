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

from .atlas import Atlas, available, build_atlas, known_variables
from .variables import VARIABLES

__version__ = "0.0.1"

__all__ = ["Atlas", "build_atlas", "available", "known_variables", "VARIABLES", "__version__"]
