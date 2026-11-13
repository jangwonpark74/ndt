# Radio planning and network digital twin workflow

Reviewed and implemented through 13 November 2026. The planner now separates source inventory, editable study assumptions, executable assignments and frozen results. It remains an uncalibrated planning-power application, not an Atoll-equivalent planning suite or a verified operational twin.

## Workflow review and implemented improvements

| Planner step | Implemented behavior | Important boundary |
|---|---|---|
| Find and identify | Region/project context, selected-site and cluster labels, bounded map label collision handling, searchable Toronto inventory table and independent named review groups. | Review groups are independent of Bell legacy simulation membership. New York records remain pole reservations. |
| Inspect inventory | Site topology, reported LTE/NR records, source-backed cell/sector/radio/antenna/port paths, missing values, source dates, immutable equipment JSON and reviewed pattern cuts. | Licensing does not establish physical connections or live operation. Imported records remain user-supplied claims. |
| Define study | Named immutable revisions, site templates or explicit source-cell assignment mode, supported carrier checks, per-path orientation/gain/loss and optional uniform-panel array geometry/steering. | New-port defaults never become fallback transmitters. Vendor cuts are reviewed separately; array geometry and element gain remain explicit assumptions. |
| Allocate power | Explicit modeled radio budgets across every assigned LTE/NR cell/path, optional equal splitting, over-allocation rejection and common carrier/environment settings within a cell. | Reported radio power is never interpreted automatically as a carrier allocation or accepted hardware budget. Unknown budgets can be saved but cannot run. |
| Qualify and apply | Current regional/equipment identity, exact cell/link provenance, qualified carrier subset, valid shared budgets, baseline/applied revision pointers and conflict-safe saving. | Original source versions remain reviewable. Rebuild is explicit, clears carrier/array assumptions and preserves prior revisions. |
| Simulate and compare | Frozen directional UMa planning-power routes, per-cell uncorrelated port-power sums, parameter A/B and saved baseline/applied comparisons. Multiple LTE/NR cells can share a site. | Fixed 25 m BS / 1.5 m UE; complete-cell domain/far-field gating; no interference, MIMO receiver, RSRP or calibrated coverage. |
| Review results | Clear setup/results separation, stale-setup notice, bounded changed-input/path/budget tables, readable one-decimal units and full source/model/assignment JSON. | Comparisons quantify the selected model. Reports do not establish deployment, measured accuracy or service quality. |

Detailed cell assignment work now uses a dedicated responsive dialog rather than expanding the map inspector. It shows project/source revision, concise readiness, 25-cell search/RAT pagination, per-path edit/remove actions and stable shared-budget inputs. The close header stays visible while scrolling; keyboard focus and Escape dismissal are covered. The existing form edits one selected port, with source-versus-study values in expandable details. New York's network panel now exposes the same radio editor; proposed reservation status is retained in frozen source evidence.

Source-cell scenarios retain full per-link templates and one equipment revision/hash. Explicit one-to-one endpoints and nonoverlapping occupied carriers are required when a physical TX port is shared across cells. Parameter B scales all target-cell ports together and rechecks shared-radio limits across all RATs before queueing and again before result publication. The model sums uncorrelated mean powers within a cell under ideal polarization-insensitive collection, then chooses the strongest supported cell of the selected RAT. Coherent array weights apply within an individual modeled port only.

Source-cell runs use `ndt.execution.v4` / `uma-source-cells-fixed-heights-v4`; prior v1/v2/v3 jobs keep their original behavior. Mixed site/cell revision comparisons use a single-port site adapter within v4. Original source bytes, coordinates, status, complete role payloads, path templates, assumptions and all-RAT budgets remain frozen. Probe JSON v5 includes the complete current assignment draft and original equipment file; existing legacy probe exports keep v4.

## Remaining enhancement plan

| Priority | Next work | Acceptance criteria and evidence needed |
|---|---|---|
| P1 | Verified equipment and antenna model qualification | Compare imported configurations against operator/vendor records with dates and hardware identifiers. Add validated pattern coordinate, interpolation, normalization and gain conventions before measured cuts can govern prediction. Test independent reference cases; retain source and qualification status. |
| P1 | Polarized/multi-panel and receiver modeling | Define cross-polarization, panel geometry, per-port phases/correlation and receiver collection assumptions before coherent combining or MIMO claims. Add independent power-conservation and orientation oracles; preserve the existing uncorrelated model identity. |
| P1 | Field-data compatibility and calibration workflow | Accept real operator captures with compatible metric definitions, carrier/time/route identity and observation quality. Produce chronological/site-separated holdout evaluation and residuals by band/environment. Do not fit synthetic/license data as measured accuracy. |
| P2 | Terrain, buildings and clutter | Specify coordinate/height datum, terrain resolution, obstruction/clutter provenance and propagation domains. Validate independent known paths and holdout measurements before coverage maps or optimization use them. |
| P2 | Reference-signal and interference models | Define LTE/NR resource/power mapping and co-channel activity/load before RSRP/SS-RSRP or SINR. Reject incompatible metric comparisons and disclose missing neighbor/channel data. |
| P2 | RF result map and comparison workflow | Add selected-cell/path-aware result overlays, uncertainty and unsupported-domain summaries using the frozen model. Keep normal inspection concise; put full diagnostics in details/exports. |
| P3 | Constrained optimization | Introduce explicit objective, demand, allowed changes, power/hardware constraints and uncertainty only after the applicable model is validated. Require reviewable proposed changes and reproducible before/after evidence. |
| P3 | Operational twin freshness | Connect operator configuration/telemetry with observation and retrieval timestamps, versioned identity and stale/missing-state handling. Delayed data must never appear as verified current operation. |

Real equipment/pattern files and compatible measured captures/endpoints were requested earlier and remain unavailable in the local application. Software workflow and model validation can progress; field calibration, verified deployment and operational freshness require those inputs. The local registry contains existing simulated/synthetic demonstrations, not a measured network validation set.

## Current validation checkpoint

The three required project records contain **186 matching features**, including RF-17 source-cell execution, RF-18 shared budgets and RF-19 historical-source review. Workbook updates preserve all 183 existing review-status/note pairs. Both Typst documents compile; new model sections, report pages and workbook rows are rendered for visual review.

TDD first demonstrated missing source-cell controls, the hidden New York editor and incomplete unsaved-draft export, then verified the corresponding implementations. Numerical tests cover independent linear-power arithmetic, shared-radio budgets across RATs, relative B allocation, invalid graphs/carriers, historical sources, old-model rejection, queued immutability, mixed assignment comparisons, New York identities and job work limits. Focused browser tests cover edit/save/apply/reload/run/report/export, historical rebuilds, pagination, budget typing focus, Escape, delayed project replies, axe and 320-1440 px geometry.

All 107 distinct cases per browser are covered: 103 controlled workflows plus four separately enabled live-provider smoke cases. Owning test processes completed successfully; no automatic retries or accessibility-rule exclusions were used. Tests demonstrate the software contract and observed provider availability, not field prediction accuracy.

| Browser | Complete controlled suite | Separate live-provider suite |
|---|---|---|
| Chromium | 103 passed, 4 opt-in skips (12.1m) | 4 passed (30.5s) |
| Firefox | 103 passed, 4 opt-in skips (7.2m) | 4 passed (20.3s) |
| Webkit | 103 passed, 4 opt-in skips (8.4m) | 4 passed (20.5s) |

After the complete Firefox run, readiness/error wording and source-target/focus behavior were improved. All 12 affected cell, source-study, array and saved-scenario workflows were rerun successfully in Firefox on the final implementation. The complete Chromium/WebKit suites ran after those fixes. The initial WebKit run passed 102 controlled cases and failed one focus assertion: clicked buttons do not always receive focus there. Passing the explicit opening control fixed the actual recovery behavior; the original keyboard assertion remains. The five cell workflows then passed in focused WebKit testing before the complete rerun. Delayed historical-source naming and a hidden save-blocking budget issue were also tested red/green; blocking messages now identify the relevant cell/path.


The published predecessor `0bc3f29` passed 98 controlled and four separately enabled live-provider cases per browser. The pinned Playwright 1.63.0 environment retains all accessibility rules and no automatic retries. Windows WebKit starts a fresh worker per spec to bound WebGL state carryover. Windows Chromium preserves the pinned default feature switches and backports the upstream TCP-port-randomization fix; these are managed test-launch settings, not application/user-browser changes.

## Primary references

- [Forsk Atoll overview](https://www.forsk.com/atoll-overview): workflow reference for multi-RAT planning, equipment, predictions and measurement integration; no equivalence claim.
- [3GPP TR 38.901 v18.0.0](https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/18.00.00_60/tr_138901v180000p.pdf): pinned reference-element/array engineering subset and UMa mean-path-loss basis, with disclosed fixed-height/domain limits.
- [TS 36.104 v18.5.0](https://www.etsi.org/deliver/etsi_ts/136100_136199/136104/18.05.00_60/ts_136104v180500p.pdf) and [TS 38.104 v18.5.0](https://www.etsi.org/deliver/etsi_ts/138100_138199/138104/18.05.00_60/ts_138104v180500p.pdf): pinned Release 18 downlink carrier subset, not complete base-station conformance.
- [NASA GT-TE-2402](https://extapps.ksc.nasa.gov/Reliability/Documents/Preferred_Practices/2402.pdf), Technical Rationale page 3: conventional far-field separation basis. The application uses its assumed array diagonal and does not claim antenna measurement accuracy.
- [Playwright fix 43605](https://github.com/microsoft/playwright/pull/43605): Windows Chromium socket-allocation test-launch backport.
