# Toronto NDT

Toronto NDT is a regional 3D city and network visualization project with Toronto and New York City regions. The [viewer README](ndt/README.md) documents its data, limitations and detailed setup.

To run it locally:

```sh
make setup
make run
```

## Directory layout

```text
ndt/
  dist/       Static application, data and vendored libraries; served directly
  scripts/    Data preparation and conversion tools
  tests/      JavaScript and Python checks
  data/       New York regional datasets
  regions.json Region catalog and navigation
  server.py   SQLite-backed local data service
  .openai/    Static hosting configuration
docs/         Research, benchmarks and preview images
graft/        Workspace code index
Makefile      Setup, run and validation commands
pyproject.toml, uv.lock  Python environment definition
```

`ndt/dist/` is checked-in application source and Toronto data, not a disposable build output. The local server initializes project-root `regions.sqlite3` from the regional datasets and serves the region catalog and assets to the viewer. Network locations are stored as individual database records. The SQLite service is required; a plain static server or the legacy static hosting configuration cannot serve this version. Research and preview material is in [`docs/`](docs/).
