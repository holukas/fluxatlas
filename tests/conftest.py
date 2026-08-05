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


def add_fluxes(frame, seed=1):
    """The turbulent fluxes, in the units and column names a FULLSET file publishes them in.

    Added on top of the meteorological frame rather than inside it, because several tests assert
    exactly which variables a plain synthetic file supplies and adding five more would change what
    those tests are about.

    The two things that have to be right for the flux tests to mean anything are the sign
    convention and the gap structure. NEE is negative when photosynthesis exceeds respiration, and
    the partitioning identity NEE = RECO - GPP holds exactly, so a test can assert it survives the
    unit conversion. And the quality flag marks roughly 45 % of records as measured, concentrated
    in daylight - which is what u* filtering does to a real record, and the reason the fluxes need
    their own coverage thresholds.
    """
    rng = np.random.default_rng(seed)
    index = frame.index
    doy = index.dayofyear.to_numpy(dtype=float)
    ta = frame["TA_F"].to_numpy()
    sw = frame["SW_IN_F"].to_numpy()

    # Gross uptake follows the light, scaled by how far into the growing season the date is.
    season = np.clip(np.sin(np.pi * (doy - 90) / 180), 0, None)
    gpp = 0.055 * sw * season * rng.uniform(0.8, 1.2, len(index))
    # Respiration follows temperature, with the usual exponential response.
    reco = 1.6 * np.exp(0.07 * (ta - 10.0)) * rng.uniform(0.85, 1.15, len(index))
    nee = reco - gpp

    # Coverage is not constant through a record - instruments drift, fail and get repaired, and a
    # month of a real flux record runs from a few per cent measured to about two thirds. Without
    # that spread every month clears every threshold by the same margin, and the tests that are
    # about thresholds would assert nothing.
    month_id = (index.year - index.year[0]) * 12 + index.month - 1
    quality = rng.uniform(0.85, 1.15, int(month_id.max()) + 1)[month_id]

    daylight = sw > 20
    # Measured where the air is turbulent enough to trust: most of the day, few of the nights.
    measured = np.where(daylight, rng.random(len(index)) < 0.80 * quality,
                        rng.random(len(index)) < 0.12 * quality)

    # Two instrument outages, in which the record is present but almost entirely gap-filled. Real
    # records have these, and without them nothing in the fixture ever falls under a warning line -
    # so every test about what the page *says* of a thinly measured span would assert nothing.
    first = int(index.year.min())
    outage = (((index.year == first + 3) & (index.month == 7))
              | ((index.year == first + 7) & (index.month == 2)))
    measured = measured & ~outage

    qc = np.where(measured, 0, rng.choice([1, 2, 3], len(index), p=[0.5, 0.3, 0.2]))

    out = frame.copy()
    # The outage takes the meteorology down with it, which is what an outage does - and it is what
    # exercises the meteorological warning line, which is set far above the flux one.
    out.loc[outage, "TA_F_QC"] = 2
    out["NEE_VUT_REF"] = nee.round(3)
    out["NEE_VUT_REF_QC"] = qc
    out["GPP_NT_VUT_REF"] = gpp.round(3)
    out["RECO_NT_VUT_REF"] = reco.round(3)
    out["LE_F_MDS"] = (0.45 * sw + rng.normal(0, 12, len(index))).round(2)
    out["LE_F_MDS_QC"] = np.where(rng.random(len(index)) < 0.68, 0, 1)
    out["H_F_MDS"] = (0.25 * sw + rng.normal(0, 10, len(index))).round(2)
    out["H_F_MDS_QC"] = np.where(rng.random(len(index)) < 0.80, 0, 1)

    # The uncertainty columns, in the shapes a FULLSET file publishes them in.
    #
    # The random term is per record and independent. The u* ensemble is five whole versions of the
    # flux, one per threshold percentile, each offset from the reference by a *constant* factor -
    # which is the property the aggregation has to preserve. A systematic offset held across a
    # whole month must not shrink when the month is summed, and a test that generated the members
    # by adding noise would not be able to tell whether it had.
    out["NEE_VUT_REF_RANDUNC"] = np.abs(rng.normal(0, 1.4, len(index))).round(3)
    for pct, factor in zip(("16", "25", "50", "75", "84"),
                           (0.90, 0.95, 1.00, 1.05, 1.10)):
        out[f"NEE_VUT_{pct}"] = (nee * factor).round(3)
    out["GPP_NT_VUT_SE"] = (0.04 * np.abs(gpp) + 0.01).round(3)
    out["RECO_NT_VUT_SE"] = (0.03 * reco).round(3)
    out["LE_RANDUNC"] = np.abs(rng.normal(0, 9.0, len(index))).round(2)
    out["H_RANDUNC"] = np.abs(rng.normal(0, 7.0, len(index))).round(2)
    return out


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
def flux_frame(frame):
    """Twelve years of synthetic half-hourly meteorology with the five fluxes beside it."""
    return add_fluxes(frame)


@pytest.fixture(scope="session")
def flux_parquet_path(tmp_path_factory, flux_frame):
    path = tmp_path_factory.mktemp("data") / "synthetic_flux_HH.parquet"
    flux_frame.to_parquet(path)
    return path


@pytest.fixture(scope="session")
def flux_csv_path(tmp_path_factory, flux_frame):
    path = tmp_path_factory.mktemp("data") / "FLX_XX-Syn_FLUXNET_FULLSET_HH_2010-2021.csv"
    return to_fluxnet_csv(flux_frame, path)


@pytest.fixture(scope="session")
def flux_atlas(flux_parquet_path):
    """A built atlas carrying the carbon fluxes, shared across the tests that only read it."""
    import fluxatlas as fa
    return fa.Atlas(flux_parquet_path, ["TA", "PREC", "NEE", "GPP", "RECO"], site="XX-Syn",
                    hourly=False, quiet=True)


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
