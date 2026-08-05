# API reference

Six modules. {mod}`fluxatlas.atlas` is the public API, and anything a front end needs belongs there
so the front ends stay thin. The rest is the machinery behind it.

| Module | Responsibility |
| --- | --- |
| {mod}`fluxatlas.atlas` | The public API: `Atlas`, `build_atlas`, `available`. |
| {mod}`fluxatlas.cli` | The command line, a thin wrapper over `atlas`. |
| {mod}`fluxatlas.io` | Reading one half-hourly FLUXNET file. |
| {mod}`fluxatlas.variables` | The registry: canonical keys, candidate columns, units, thresholds. |
| {mod}`fluxatlas.stats` | Theil-Sen trend, spells, growing season, rounding. |
| {mod}`fluxatlas.build` | The computation: metrics, badges, day tests, normals, seasons, payload, render. |

## fluxatlas

```{eval-rst}
.. automodule:: fluxatlas
   :no-members:
```

The package namespace re-exports the public API, so `fa.Atlas` and `fa.build_atlas` are the entry
points to use:

```{eval-rst}
.. autoclass:: fluxatlas.Atlas
   :members:
   :special-members: __init__

.. autofunction:: fluxatlas.build_atlas

.. autofunction:: fluxatlas.available

.. autofunction:: fluxatlas.known_variables
```

## fluxatlas.atlas

```{eval-rst}
.. automodule:: fluxatlas.atlas
   :no-members:
```

## fluxatlas.io

```{eval-rst}
.. automodule:: fluxatlas.io
   :members: columns_of, available, resolve, read_fluxnet, span
```

## fluxatlas.variables

```{eval-rst}
.. automodule:: fluxatlas.variables
   :members: Variable, uncertainty, uncertainty_note, rank_first, family, coverage, known, make
```

The registry itself is on the [variables](variables.md) page, where the tables come from it
directly.

## fluxatlas.stats

```{eval-rst}
.. automodule:: fluxatlas.stats
   :members: r, rlist, trend, longest_spell, growing_season, resample_agg, doy365, rank_of,
             percentile_domain
```

## fluxatlas.build

The large module, and not part of the public API. A front end should not need it. It is documented
here because the decisions behind the page live in it.

```{eval-rst}
.. automodule:: fluxatlas.build
   :no-members:
```

### Seasons

```{eval-rst}
.. autofunction:: fluxatlas.build.parse_season_spec
.. autofunction:: fluxatlas.build.season_scheme
.. autofunction:: fluxatlas.build.season_shift
.. autofunction:: fluxatlas.build.season_note
.. autofunction:: fluxatlas.build.season_periods
.. autofunction:: fluxatlas.build.season_ids
```

### Years

```{eval-rst}
.. autofunction:: fluxatlas.build.year_periods
.. autofunction:: fluxatlas.build.yearly_frames
.. autofunction:: fluxatlas.build.year_events
.. autofunction:: fluxatlas.build.year_extras
.. autofunction:: fluxatlas.build.year_standout
.. autofunction:: fluxatlas.build.place_among
.. autofunction:: fluxatlas.build.ordinal
```

### Badges

```{eval-rst}
.. autofunction:: fluxatlas.build.badge_at_scale
.. autofunction:: fluxatlas.build.evaluate_badges
```

### Aggregation and coverage

```{eval-rst}
.. autofunction:: fluxatlas.build.aggregate_uncertainty
.. autofunction:: fluxatlas.build.thin_spans
.. autofunction:: fluxatlas.build.report_thin_spans
.. autofunction:: fluxatlas.build.normals
.. autofunction:: fluxatlas.build.metric_trends
.. autofunction:: fluxatlas.build.epoch_split
```

### Building and rendering

```{eval-rst}
.. autofunction:: fluxatlas.build.build_payload
.. autofunction:: fluxatlas.build.render
```

## fluxatlas.cli

```{eval-rst}
.. automodule:: fluxatlas.cli
   :members: build_parser, build_mapping, show, main
```

The options are listed on [the command line](cli.md) page.
