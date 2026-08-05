# The command line

```bash
fluxatlas INPUT --list
fluxatlas INPUT -o atlas.html --vars TA,PREC
fluxatlas INPUT -o atlas.html --var TA=air_temp --qc TA=TA_FLAG
```

`python -m fluxatlas` is the same entry point.

The command line is a thin wrapper over {mod}`fluxatlas.atlas`. Nothing is computed in it that a
caller using the library would have to write again.

## Naming the variables

There are two ways to say which variables to build, and one call can use both.

`--vars KEY[,KEY...]`
: Names canonical keys and lets the registry find the columns. Use it where the file uses FLUXNET
  names (`TA_F`, `P_F`, `SW_IN_F`, and so on). Repeatable, and comma-separated lists work.

`--var KEY=COLUMN`
: Names the column outright, which is what a file with its own naming needs. `--qc KEY=COLUMN` adds
  the quality flag beside it (0 measured, above 0 modelled). `--factor KEY=NUMBER` converts the
  column onto the canonical unit. Both refine a `--var` mapping and are an error without one.

`--list` prints what the registry can find in a file. Run it first to see whether `--vars` will do.

Naming nothing builds every registry variable the file can supply.

## Examples

```bash
# What does this file carry? Read from the header, so it is quick even on a 552 MB file.
fluxatlas record.csv --list

# Everything the registry finds, written beside the input as <SITE>_atlas.html
fluxatlas record.csv

# Two variables, named by canonical key
fluxatlas record.csv -o atlas.html --vars TA,PREC

# A file with its own column names
fluxatlas record.parquet -o atlas.html --var TA=air_temp --qc TA=TA_FLAG

# A column published in Pa, converted onto the canonical kPa
fluxatlas record.parquet -o atlas.html --var VPD=vpd_pa --factor VPD=0.001

# Two half-years instead of four seasons, and a smaller file
fluxatlas record.csv -o atlas.html --seasons DJFMAM --no-hourly
```

## File size

`--no-hourly` drops the hourly arrays behind the day panel's diurnal charts. They are most of the
output: a twenty-one-year FULLSET page with them runs to about 6 MB. Dropping them costs the
diurnal composites and nothing else.

## Every option

```{eval-rst}
.. argparse::
   :module: fluxatlas.cli
   :func: build_parser
   :prog: fluxatlas
```

## Errors

An argument error, an unknown canonical key, a `--qc` or `--factor` that refines nothing, a missing
input file, or an invalid `--seasons` value: each exits with a message and a non-zero status. The
season value is checked before the file is opened, so a typo does not first cost a read of several
hundred megabytes.
