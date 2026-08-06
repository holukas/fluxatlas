# Examples

Two scripts, and they are the two kinds of file this package reads.

| Script | The case it shows |
| --- | --- |
| `build_fluxnet_atlas.py` | A **FLUXNET-standardized** file. No configuration: the registry knows the column names already. **Start here.** |
| `build_lae_meteo_atlas.py` | A local product whose columns were never named for FLUXNET, so they are **mapped by hand**. |

If you have a FLUXNET file — a FULLSET record, a FLUXMET release, EddyPro's FLUXNET
output — the first one is the case you are in, and nothing below the first command is
required reading.

## A FLUXNET file, from the command line

### 1. Ask the file what it carries

```bash
fluxatlas EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv --list
```

```text
  variable  column                 quality flag           unit
  TA        TA_F                   TA_F_QC                °C
  PREC      P_F                    P_F_QC                 mm
  SW_IN     SW_IN_F                SW_IN_F_QC             W m⁻²
  VPD       VPD_F                  VPD_F_QC               kPa  (x0.1)
  RH        RH                     -                      %
  SWC       SWC_F_MDS_1            SWC_F_MDS_1_QC         %
  NEE       NEE_VUT_REF            NEE_VUT_REF_QC         g C m⁻²  (x0.0216198)
  GPP       GPP_NT_VUT_REF         NEE_VUT_REF_QC         g C m⁻²  (x0.0216198)
  RECO      RECO_NT_VUT_REF        NEE_VUT_REF_QC         g C m⁻²  (x0.0216198)
  LE        LE_F_MDS               LE_F_MDS_QC            W m⁻²
  H         H_F_MDS                H_F_MDS_QC             W m⁻²
```

This reads the header and nothing else, so it answers in well under a second even on a
552 MB file. It is worth running first: it tells you which of a FULLSET's many variants
of the same flux the registry would pick, before you spend a minute reading the record.

### 2. Build the atlas

```bash
fluxatlas EUF_CH-Oe2_FLUXNET_FLUXMET_HH_2004-2024_v1.3_r1.csv -o CH-Oe2_atlas.html
```

That is the whole of it. A FLUXNET file needs no mapping, no column names and no units,
because the registry already knows the convention its columns are named to. Every
variable in the table above goes on the page, each converted onto its canonical unit,
each with its quality flag beside it.

The output is one self-contained HTML file. It carries its own scripts and styles, so it
opens from a memory stick with no server and no network.

## The flags worth knowing

Everything past that point is optional, and each of these has a default that works.

**Choose what the page is about.** The default is a survey of the whole file, which is
right for an unfamiliar record. A chosen selection gives a page that answers a question,
and it is a smaller page rather than a broken one — metrics whose variables are absent
are not offered, and badges whose inputs are missing are withheld with the reason.

```bash
fluxatlas record.csv -o carbon.html --vars NEE,GPP,RECO
```

**Cut the file size.** The hourly arrays behind the day panel's diurnal charts are most
of the output. The eleven-variable CH-Oe2 page above is 5.9 MB with them and 2.3 MB
without. Drop them if you are sharing the page rather than reading the diurnal cycle.

```bash
fluxatlas record.csv -o atlas.html --no-hourly
```

**Narrow the record.** Both bounds are inclusive, and each only ever narrows: a
`--first-year` before the record starts does not extend it. Partial years at either end
are dropped whether or not you pass these.

```bash
fluxatlas record.csv -o atlas.html --first-year 2010 --last-year 2020
```

**Change the seasons.** `--seasons` names only the *first* season; the rest of the year
follows in blocks of the same length, so the length has to divide 12. `DJF` gives the
usual four, `DJFMAM` gives two half-years, and `none` drops the scale for a site whose
year has no seasons.

```bash
fluxatlas record.csv -o atlas.html --seasons DJFMAM
```

**Name the site and the page.** The site identifier is otherwise guessed from the file
name.

```bash
fluxatlas record.csv -o atlas.html --site CH-Oe2 --site-long "Oensingen, Switzerland — cropland"
```

**Open it when it is done.** Saves finding the file.

```bash
fluxatlas record.csv -o atlas.html --open
```

`fluxatlas --help` lists every option, and the [CLI reference](https://fluxatlas.readthedocs.io/en/stable/cli.html)
is generated from the same parser.

## The same thing from Python

```python
import fluxatlas as fa

fa.available("record.csv")                      # what the file carries, from the header alone
fa.build_atlas("record.csv", "atlas.html")      # read, build and write in one call
```

Keep the built object when more than one page comes out of one read. The payload is
built once, on construction — that is the expensive step, and `write` can then run as
often as needed.

```python
atlas = fa.Atlas("record.csv", ["NEE", "GPP", "RECO"], site_long="Oensingen, cropland",
                 first_year=2010, hourly=False)
atlas.write("carbon.html")
atlas.write("//share/published/CH-Oe2_carbon.html")   # nothing is recomputed
```

## Running the scripts

```bash
uv run python examples/build_fluxnet_atlas.py --input YOUR_FULLSET.csv --open
```

Prints what the file can supply, then the default build, then every option beside the
flag and the keyword argument that set it. It writes **one** page. Use `--out` to write
somewhere outside the repository, which is worth doing on a long record.

Its default input is a real FULLSET record for the Oensingen cropland — 248 columns,
368,208 half-hours, 2004–2024, 552 MB — which is **not committed**. `.gitignore` excludes
`examples/data/*.csv` so a file that size cannot be added by accident. Point `--input` at
your own.

```bash
uv run python examples/build_lae_meteo_atlas.py --open
```

The mapping case, and it needs no data of yours: it runs on
`data/CH-LAE_meteo_30min_2005-2025.parquet`, a 9.3 MB twenty-one-year six-variable
extract that **is** committed. It builds two atlases from one read — all six variables,
then air temperature alone — which is the selection behaviour in a single run. The
extract keeps its CH-LAE column names deliberately, because naming columns by hand is
the general case for a local product.

`make_example_data.py` is what cut that extract down. It needs the CH-LAE data folder and
is here for provenance, not as a step anyone else runs.

Both scripts write into `output/`, which is not tracked.
