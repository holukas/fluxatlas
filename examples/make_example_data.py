"""Cut the example dataset out of the CH-LAE merged meteo product.

The upstream product is ~48 MB and carries 52 columns, most of which an atlas never reads. This
takes the six variables the registry describes plus their fill flags, which is a file small enough
to live in the repository and complete enough to build every metric and badge the library has.

The source is not public and lives outside any repository, so this script is here for provenance
and for regenerating the extract - not as a step anyone else has to run. The extract it produces is
committed; run this only to refresh it.

    uv run python examples/make_example_data.py
"""

from pathlib import Path

import pandas as pd

SOURCE = Path(r"F:\Sync\luhk_work\dev-data\datasets-data\dataset_ch-lae_flux_product-data"
              r"\workflow\10_METEO\30_PRODUCTS\99_METEO_MERGED_2004-2025.parquet")
OUT = Path(__file__).parent / "data" / "CH-LAE_meteo_30min_2005-2025.parquet"

# The homogenised column wherever the product publishes one: it is the column that may be compared
# across the record, which is what every anomaly, rank and trend on the atlas does.
COLUMNS = {
    "TA_T1_47_1_HOMOGENIZED_gfXG": "air temperature, homogenised and gap-filled",
    "FLAG_TA_T1_47_1_ISFILLED": "TA fill flag, 0 = measured",
    "PREC_TOT_T1_47_1_HOMOGENIZED": "precipitation, homogenised",
    "FLAG_PREC_TOT_T1_47_1_ISFILLED": "PREC fill flag, 0 = measured",
    "SW_IN_T1_47_1_gfXG": "incoming shortwave, gap-filled",
    "FLAG_SW_IN_T1_47_1_ISFILLED": "SW_IN fill flag, 0 = measured",
    "VPD_T1_47_1": "vapour pressure deficit",
    "FLAG_VPD_T1_47_1_ISFILLED": "VPD fill flag, 0 = measured",
    "RH_T1_47_1": "relative humidity",
    "SWC_FF1_0.2_1_HOMOGENIZED": "soil water content at 0.2 m, homogenised",
}

# 2004 is short at the start of several of these series; the atlas needs whole years.
FIRST_YEAR = 2005


def main():
    if not SOURCE.exists():
        raise SystemExit(f"source not found: {SOURCE}\nThis script only runs where the CH-LAE "
                         f"data folder is available.")
    df = pd.read_parquet(SOURCE)
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise SystemExit(f"the product no longer carries: {', '.join(missing)}")

    out = df.loc[df.index.year >= FIRST_YEAR, list(COLUMNS)].copy()
    out.index.name = "TIMESTAMP_MIDDLE"

    # None of these are measured to anything near float64. float32 carries seven significant
    # digits, which is several orders more than a 0.1 °C thermometer or a 0.1 mm gauge resolves,
    # and it halves a file that has to live in the repository. Flags are small integers.
    for col in out.columns:
        out[col] = (out[col].astype("Int8") if col.startswith("FLAG_")
                    else out[col].astype("float32"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(OUT, compression="zstd")

    size = OUT.stat().st_size / 1024 / 1024
    print(f"{OUT.name}: {out.shape[0]:,} records x {out.shape[1]} columns, "
          f"{out.index[0]:%Y-%m-%d} to {out.index[-1]:%Y-%m-%d}, {size:.1f} MB")
    for col, what in COLUMNS.items():
        share = out[col].notna().mean() * 100
        print(f"  {col:<34} {share:5.1f} % present   {what}")


if __name__ == "__main__":
    main()
