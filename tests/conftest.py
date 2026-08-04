"""Shared fixtures.

Most tests run on **synthetic** data rather than on the bundled CH-LAE extract. Two reasons: a test
that asserts a number should own the data that produces it, and the suite has to pass in a checkout
where the 9 MB example file was never fetched. The synthetic record is built to be long enough for
the machinery that needs history - `MIN_NORMAL_YEARS` is 8, so a normal, a rank and a trend all
need roughly a decade before they exist at all.

The tests that do read the bundled file are marked `example` and skip when it is absent.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

FREQ = "30min"
YEARS = 12
FIRST_YEAR = 2010


def synthetic_frame(first_year=FIRST_YEAR, years=YEARS, seed=0, warming_per_decade=0.8):
    """A plausible half-hourly meteo record: seasonal cycle, diurnal cycle, noise and a trend.

    Deliberately not a random walk. The seasonal and diurnal cycles are what make the daily
    statistics, the threshold days and the calendar-month normals behave like the real thing, and
    the imposed warming is what lets a test assert that the trend estimator finds a slope that is
    actually there.
    """
    rng = np.random.default_rng(seed)
    last_year = first_year + years - 1
    index = pd.date_range(f"{first_year}-01-01 00:15", f"{last_year}-12-31 23:45", freq=FREQ)

    doy = index.dayofyear.to_numpy(dtype=float)
    hour = index.hour.to_numpy(dtype=float) + index.minute.to_numpy(dtype=float) / 60
    elapsed_years = (index.year.to_numpy(dtype=float) - first_year)

    season = -10.0 * np.cos(2 * np.pi * (doy - 15) / 365.25)   # coldest mid-January
    diurnal = -5.0 * np.cos(2 * np.pi * (hour - 14) / 24)      # warmest mid-afternoon
    ta = (9.0 + season + diurnal
          + warming_per_decade * elapsed_years / 10
          + rng.normal(0, 2.0, len(index)))

    # Precipitation: mostly dry, occasionally wet, wetter in summer.
    wet = rng.random(len(index)) < (0.03 + 0.02 * np.clip(season, 0, None) / 10)
    prec = np.where(wet, rng.gamma(1.2, 1.1, len(index)), 0.0)

    # Shortwave: zero at night, a seasonal amplitude, and cloud knocking lumps out of it.
    daylight = np.clip(np.sin(np.pi * (hour - 6) / 12), 0, None)
    # Peaks at the June solstice (doy 172), so `+cos` about that day rather than `-cos`.
    clear_sky = (450 + 250 * np.cos(2 * np.pi * (doy - 172) / 365.25)) * daylight
    sw_in = np.clip(clear_sky * rng.uniform(0.25, 1.0, len(index)), 0, None)

    frame = pd.DataFrame(
        {
            "TA_F": ta.round(2),
            "TA_F_QC": rng.choice([0, 1], len(index), p=[0.93, 0.07]),
            "P_F": prec.round(2),
            "P_F_QC": rng.choice([0, 1], len(index), p=[0.97, 0.03]),
            "SW_IN_F": sw_in.round(1),
            "SW_IN_F_QC": rng.choice([0, 1], len(index), p=[0.9, 0.1]),
        },
        index=index,
    )
    frame.index.name = "TIMESTAMP_MIDDLE"
    return frame


def to_fluxnet_csv(frame, path):
    """Write a frame out in the shape a FLUXNET file arrives in.

    Integer `TIMESTAMP_START`/`TIMESTAMP_END`, `-9999` for missing, no index column - which is the
    format the reader has to cope with and the one the parquet fixtures never exercise.
    """
    start = frame.index - pd.Timedelta(FREQ) / 2
    end = frame.index + pd.Timedelta(FREQ) / 2
    out = frame.copy()
    out.insert(0, "TIMESTAMP_END", end.strftime("%Y%m%d%H%M"))
    out.insert(0, "TIMESTAMP_START", start.strftime("%Y%m%d%H%M"))
    out.to_csv(path, index=False, na_rep="-9999")
    return path


@pytest.fixture(scope="session")
def frame():
    """Twelve years of synthetic half-hourly data, in FLUXNET column names."""
    return synthetic_frame()


@pytest.fixture(scope="session")
def parquet_path(tmp_path_factory, frame):
    path = tmp_path_factory.mktemp("data") / "synthetic_HH.parquet"
    frame.to_parquet(path)
    return path


@pytest.fixture(scope="session")
def csv_path(tmp_path_factory, frame):
    path = tmp_path_factory.mktemp("data") / "FLX_XX-Syn_FLUXNET_HH_2010-2021.csv"
    return to_fluxnet_csv(frame, path)


@pytest.fixture(scope="session")
def ta_atlas(parquet_path):
    """A built one-variable atlas, shared across the tests that only read it."""
    import fluxatlas as fa
    return fa.Atlas(parquet_path, ["TA"], site="XX-Syn", hourly=False, quiet=True)


@pytest.fixture(scope="session")
def full_atlas(parquet_path):
    """A built three-variable atlas, shared across the tests that only read it."""
    import fluxatlas as fa
    return fa.Atlas(parquet_path, ["TA", "PREC", "SW_IN"], site="XX-Syn", hourly=False, quiet=True)
