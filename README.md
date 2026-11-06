# Toronto NDT

Toronto NDT is a 3D city and network visualization project. The [viewer README](ndt/README.md) documents its data, limitations and detailed setup.

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
  .openai/    Static hosting configuration
docs/         Research, benchmarks and preview images
graft/        Workspace code index
Makefile      Setup, run and validation commands
pyproject.toml, uv.lock  Python environment definition
```

`ndt/dist/` is checked-in application source and data, not a disposable build output. Its path is also used by the hosting configuration. Research and preview material is in [`docs/`](docs/).
