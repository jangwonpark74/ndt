# NDT

NDT is a regional 3D city and network visualization project with Toronto and New York City regions. The [viewer README](ndt/README.md) documents its data, limitations and detailed setup.

The integrated **Drive tests** workspace combines saved Task routes with DM capture replay, investigation, reporting, virtual drives and planning-power Parameter A/B comparison. Open it from project navigation, Project Overview or a saved Task route. See the [integration plan and delivery status](docs/VIRTUAL_DRIVE_TEST_INTEGRATION_PLAN.md).

The **Network** inspector supports site topology review, LTE/NR filters, site/project cluster labels and independent radio/antenna probe studies. See the [radio planning workflow review and enhancement plan](docs/RADIO_PLANNING_ENHANCEMENT_PLAN.md) for implemented improvements, data limitations and prioritized next steps.

To run it locally:

```sh
make setup
make run
```

On Windows 11, use PowerShell (uv and Node.js must be installed):

```powershell
.\make.ps1 setup
.\make.ps1 run
.\make.ps1 check
.\make.ps1 test-ui
```

The PowerShell `test-ui` target installs missing npm dependencies and the selected Playwright browser; downloads require network access. Set `NDT_BROWSER` to `chromium`, `firefox` or `webkit` (default: `chromium`). The test commands use uv-managed Python; `PYTHON` can select another interpreter for browser fixtures and JavaScript parity tests. Run `.\make.ps1 help` for all targets. Set `-HostAddress` or `-Port` for the server, for example `.\make.ps1 run -Port 5180`. `HOST`, `PORT`, `UV`, `NODE` and `UV_CACHE_DIR` environment variables are also supported.

Playwright is temporarily pinned to 1.63.0 because 1.65.0 triggers a [confirmed Firefox ARIA reflection crash](https://github.com/microsoft/playwright/issues/43967). The 1.64.1 Firefox build also hangs on a blank-page viewport resize here. Keep the named-reference and resize regression passing when upgrading; no axe rules are disabled.

## Directory layout

```text
ndt/
  dist/       Static application, data and vendored libraries; served directly
    drive-test/ Integrated DM workspace with model, ViewModel and view modules
  backend/    HTTP service, routing, task storage, and drive-test services
    dm/       Capture storage, planning adapter, virtual-drive worker and HTTP API
  scripts/    Data preparation and conversion tools
  tests/
    unit/     JavaScript unit and boundary checks
    python/   Python unit and integration checks
    ui/       Playwright browser tests
    fixtures/ Browser-test fixture server
  data/       New York regional datasets
  regions.json Region catalog and navigation
  server.py   Stable command-line launcher for the backend service
  .openai/    Static hosting configuration
docs/         Research, benchmarks and preview images
Makefile      Setup, run and validation commands
make.ps1      Windows PowerShell equivalents
pyproject.toml, uv.lock  Python environment definition
```

`ndt/dist/` is checked-in application source and Toronto data, not a disposable build output. The local server initializes `var/regions.sqlite3` from the regional datasets and serves the region catalog and assets to the viewer. Network locations are stored as individual database records. The SQLite service is required; a plain static server or the legacy static hosting configuration cannot serve this version. Research and preview material is in [`docs/`](docs/).

## Drive tests

1. Select a Project and save a Task with a route and speed cases, such as `20, 40, 60` km/h.
2. Open **Drive tests**. Import a normalized capture for replay/analysis, or select **Virtual drive** or **Parameter A/B** in Test setup.
3. A/B uses the same route, speed and sample grid on both sides. A sets baseline EIRP for the planning transmitters; B changes the selected transmitter. Three speed cases produce six Test IDs and three paired comparisons.
4. Associate measured captures with their Task route before **Compare aligned route**. Imported A/B is an observational comparison. Export analysis or experiment JSON to retain the frozen inputs and comparison basis.

Virtual drives emit fixed-height UMa `predicted_rx_dbm`, never measured RSRP. Legacy studies use each eligible site's lowest reported frequency and isotropic assumptions. Applied scenarios add qualified LTE/NR templates, source-cell port assignments, shared radio budgets, uniform arrays and explicitly linked full-sphere scalar gain grids. Saved baseline/applied A/B freezes each revision's inputs and source evidence. New York reservation-based studies require imported radio paths; reservation status does not establish live service. Each run executes one route at constant speed. Interference, handover, traffic, throughput, latency and field calibration remain unavailable. See the [workflow and remaining plan](docs/RADIO_PLANNING_ENHANCEMENT_PLAN.md).

The registry defaults to `var/drive_tests.sqlite3` beside the planning database. When a default database is absent, startup copies the corresponding old root database, or the older `ndt/var/` database if the root file is absent, without overwriting the destination. Stop older viewer processes before migration; source files are retained. Override with `--dm-db`. To adopt an existing standalone DM registry without overwriting a destination:

```sh
uv run --locked python ndt/server.py --import-dm /path/to/drive_tests.sqlite3
```

This copies one registry through SQLite's backup API. It does not combine two existing registries. The integrated application then runs without the source DM directory. Back up both SQLite databases with SQLite's backup API, retain original imported captures separately, and keep generated registries out of Git. DM API access is limited to loopback Host and same-origin requests.

## Verification

`make check` runs the original NDT tests, imported DM storage/analytics regressions, recursive MVVM boundary checks, integration contracts, HTTP checks and Python/JavaScript radio-model parity. HTTP tests require localhost binding.

```sh
make check
make test-ui
npm run test:ui -- ndt/tests/ui/dm-integration.spec.cjs
NDT_BROWSER=firefox npm run test:ui
NDT_BROWSER=webkit npm run test:ui
```

Install the selected Playwright browser when needed. The suite uses disposable planning/test databases, controlled map styles and separate opt-in live tests. It covers Task navigation, A/B execution/cancellation, route association, profile conflicts, recovery, findings, exports, 100,000-observation capture and frozen RF review, paired cell/port overlays, worker cancellation/source checks, axe accessibility and 320–1440 px geometry. Failures retain Playwright traces, screenshots and videos. `NDT_UI_PORT` changes the main test-server port; `NDT_DM_EVIDENCE_DIR` selects the drive-test evidence directory. Browser availability and live-provider qualification remain separate from deterministic browser tests.


Radio studies now support explicit imported LTE/NR cell and antenna-port assignments in Toronto and New York, alongside legacy site templates. Open **Network → Radio and antenna study → Execution assignment model → Imported LTE / NR cell and port assignments**, then **Review cell assignments**. Enter modeled shared-radio budgets, review exact carriers and per-path antenna assumptions, save and apply. Reported radio-total power is never allocated automatically. The selected-port probe remains independent; virtual drives sum uncorrelated mean port powers per cell with fixed-height UMa and disclosed receiver/domain assumptions. Proposed reservations remain proposed. See [the enhancement plan](docs/RADIO_PLANNING_ENHANCEMENT_PLAN.md) for current limitations and remaining validation work.

Frozen simulated runs also expose **RF results**: selected cell/site or port route overlays, exact path gates, paired A/B deltas and full evidence export. Sensitivity is an optional user assumption, not a confidence interval or field calibration. See the [workflow and remaining plan](docs/RADIO_PLANNING_ENHANCEMENT_PLAN.md).
