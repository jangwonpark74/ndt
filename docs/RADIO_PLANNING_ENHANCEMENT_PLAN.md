# Radio planning and network digital twin workflow

Reviewed and implemented through 13 November 2026. The planner now separates source inventory, editable study assumptions, executable assignments and frozen results. It remains an uncalibrated planning-power application, not an Atoll-equivalent planning suite or a verified operational twin.

## Workflow review and implemented improvements

| Planner step | Implemented behavior | Important boundary |
|---|---|---|
| Find and identify | Region/project context, selected-site and cluster labels, bounded map label collision handling, searchable Toronto inventory table and independent named review groups. | Review groups are independent of Bell legacy simulation membership. New York records remain pole reservations. |
| Inspect inventory | Site topology, reported LTE/NR records, source-backed cell/sector/radio/antenna/port paths, missing values, source dates, immutable equipment JSON, reviewed relative cuts and numerically qualified full-sphere scalar model evidence. | Licensing does not establish physical connections or live operation. Imported records remain user-supplied claims. |
| Define study | Named immutable revisions, site templates or explicit source-cell assignment mode, supported carrier checks, per-path orientation/gain/loss and optional uniform-panel array geometry/steering or explicitly linked total realized-gain grids, plus separate explicit Model-2 LOS receiver assumptions. | New-port defaults never become fallback transmitters. Two relative cuts remain review-only. Full-sphere grids require explicit gain/reference/coordinates, declared hardware/port binding and source-state review; numerical checks do not verify hardware. |
| Allocate power | Explicit modeled radio budgets across every assigned LTE/NR cell/path, optional equal splitting, over-allocation rejection and common carrier/environment settings within a cell. | Reported radio power is never interpreted automatically as a carrier allocation or accepted hardware budget. Unknown budgets can be saved but cannot run. |
| Qualify and apply | Current regional/equipment identity, exact cell/link provenance, qualified carrier subset, valid shared budgets, baseline/applied revision pointers and conflict-safe saving. | Original source versions remain reviewable. Rebuild is explicit, clears carrier/array/grid/polarization assumptions and preserves prior revisions. |
| Simulate and compare | Frozen directional UMa planning-power routes, per-cell uncorrelated port-power sums, parameter A/B and saved baseline/applied comparisons. Multiple LTE/NR cells can share a site. | Fixed 25 m BS / 1.5 m UE; complete-cell domain/far-field gating; no interference, MIMO receiver, RSRP or calibrated coverage. |
| Review results | Clear setup/results separation, stale-setup notice, bounded changed-input/path/budget tables, readable one-decimal units, source-model evidence/frame checks and full source/model/assignment JSON. | Comparisons quantify the selected model. Reports do not establish deployment, measured accuracy or service quality. |

Detailed cell assignment work now uses a dedicated responsive dialog rather than expanding the map inspector. It shows project/source revision, concise readiness, 25-cell search/RAT pagination, per-path edit/remove actions and stable shared-budget inputs. The close header stays visible while scrolling; keyboard focus and Escape dismissal are covered. The existing form edits one selected port, with source-versus-study values in expandable details. New York's network panel now exposes the same radio editor; proposed reservation status is retained in frozen source evidence.

Source-cell scenarios retain full per-link templates and one equipment revision/hash. Explicit one-to-one endpoints and nonoverlapping occupied carriers are required when a physical TX port is shared across cells. Parameter B scales all target-cell ports together and rechecks shared-radio limits across all RATs before queueing and again before result publication. Scalar v4/v5 sums uncorrelated mean powers within a cell under ideal polarization-insensitive collection, then chooses the strongest supported cell of the selected RAT. Coherent array weights apply within an individual modeled port only.

Scalar source-cell runs without source grids or an explicit receiver use `ndt.execution.v4` / `uma-source-cells-fixed-heights-v4`; prior v1/v2/v3 jobs keep their original behavior. Mixed site/cell revision comparisons use a single-port site adapter within v4. Original source bytes, coordinates, status, complete role payloads, path templates, assumptions and all-RAT budgets remain frozen. Probe JSON v5 includes the complete current assignment draft and original equipment file; existing legacy probe exports keep v4.

## Full-sphere source-pattern implementation

The custom equipment-v2 `ndt.scalar-gain-grid.v1` contract now supports a complete absolute total realized-gain sphere, nonuniform frequency/angle axes, seam/pole consistency, real positive reference impedance and matched other ports. Exact integration of the interpolated linear-power field rejects passive-power violations without silently rescaling data. The import remains bounded to 2 MB and 250,000 total grid samples. Two relative cuts are never reconstructed into a guessed model.

A dedicated pattern dialog separates numerical readiness and source claims from the map inspector. It provides labeled elevation/azimuth axes, a readable heatmap/color scale, independent frequency/angle queries, expandable source/frame checks and evidence export. Hardware mismatches remain inspectable but cannot be selected. Preview frequency does not alter the study carrier. Selecting a grid derives its peak gain bound and requires explicit mechanical downtilt/roll when unreported; the source electrical state is embedded once. The dialog is checked for Escape/focus recovery, accessibility and 320–1440 px geometry. The report shows conventions, electrical state, declared evidence, frame efficiency and hashes.

Prediction uses center-frequency linear-power interpolation with complete occupied-band coverage and no extrapolation. The frequency-interpolated peak is an upper bound when lobes move; directional loss cancels that bound so antenna gain is counted once. Declared dimension supplies the `2D²/λ` far-field gate. Source-grid library revisions use `uma-source-patterns-v4`; runs with a grid on either comparison side use `ndt.execution.v5` / `uma-source-patterns-fixed-heights-v5`. Original source bytes and selected qualification are frozen once. Previous engines reject grid reinterpretation. Probe JSON v6 retains the complete draft and source evidence. Both A/B sides are preflighted before either member is published, including shared budgets.

This is a custom scalar model format, not a 3GPP pattern exchange specification or complete antenna/channel conformance. The UMa basis remains pinned to TR 38.901. A measured/vendor-simulated pattern label is an unverified source claim; numerical qualification is explicitly separate. The source remains scalar; the separate explicit Model-2 LOS receiver below does not recover polarized vendor fields. Coherent inter-port phases, MIMO and measured field accuracy remain outside this implementation.

## Frozen RF result review implementation

The dedicated **RF results** workspace now replays all contributors under the frozen v1-v6 engines, verifies recorded strongest power/serving identity, and provides selected cell/site or port overlays on offline/live maps. Frozen site labels and geometric connectors support exact observation review. Concise cards precede expandable both-side domain summaries and paginated path calculations. Current/reference IDs remain visible; large inventories have bounded search controls. This keeps detailed diagnostics out of the map-side inventory inspector.

Paired A/B deltas require the same experiment, snapshot, speed case, route, RAT and exact observation grid. Assignment changes remain explicit; unsupported samples stay unavailable. Valid published members of a comparison that failed acceptance remain inspectable without changing acceptance. Sensitivity is blank by default; optional symmetric 0-30 dB user assumptions use twice the half-width for a conservative delta bound, with no confidence, calibration or error-cancellation claim. Counts describe samples rather than coverage.

An owned module worker supplies progress, cancellation, source-byte/qualification verification and guards against stale run/reference/target messages. Full JSON retains all samples and both frozen source contexts; Test report contains a concise optional summary. The review writes no planning or test state. The numerical/receiver/terrain/interference limitations of the underlying models remain in force.

## Explicit LOS receiver implementation

**Receiver study** now separates collection assumptions from scalar source evidence. Its dedicated responsive dialog names project/draft, previews the LOS change across all templates, and offers one linear polarization or ideal dual-orthogonal collection. Single collection exposes receiver bearing/downtilt/roll/slant; dual hides orientation because total collected power is invariant. Apply explicitly sets included TX templates to LOS and the chosen slant/non-grid roll, with per-port editing afterward. Grid mechanical roll is reused once. Cancel leaves a clean draft untouched; stale project/draft or busy source context blocks Apply. Assignment details expose the selected antenna/polarization without expanding the map inspector.

The pinned TR 38.901 clause 7.3.2 Model-2 subset projects unit transverse linear fields in a reciprocal shared local ENU LOS link. A single receiver uses squared field dot product; ideal orthogonal receive powers sum to available scalar power without added gain. Opposing look directions can require opposite slant signs. Source total realized gain remains scalar: TX polarization is a separate study assumption, not inferred vendor field data. Non-grid panel roll rotates both scalar pattern and field. Known ideal nulls contribute zero power, with no finite dBm; another valid cell port can still supply power.

Receiver revisions use `uma-los-receiver-v5`; a receiver on either comparison side selects `ndt.execution.v6` / `uma-los-receiver-fixed-heights-v6`. Both role configurations, original source and constraints are frozen; an absent receiver keeps its scalar baseline behavior. Both members are validated before publication, including all-RAT budgets. Prior frozen engines keep their meaning and refuse new fields. Probe JSON v7, RF worker replay, execution setup and Test report expose the same assumptions. An entirely zero member remains inspectable after comparison route-coverage failure; acceptance is unchanged.

The reference model retains fixed 25 m/1.5 m heights, shared local frame, geodesic ground range, site-coincident phase centers and uncorrelated port powers. It supplies no NLOS depolarization, multipath polarization transfer, Earth-curvature frame transport, polarized vendor fields, coherent multi-panel/port phases, MIMO matrix, reference-signal allocation, interference or field calibration. Source copy/rebuild clears TX polarization for explicit re-review while retaining original evidence and saved versions. Transmitted EIRP/budgets and existing carrier/domain/far-field/work limits remain in force.

## Field compatibility and calibration diagnostics

**Field validation** now provides a full-width evidence, holdout and results workflow. Its measurement template leaves provenance/instrument/configuration attestations unknown, pins capture/prediction/equipment/route hashes and requires actual operator desired-carrier local-mean power at the same receiver reference. LTE/NR RSRP and RSSI are incompatible definitions and are never converted. `measured_rx_dbm` and explicit quality remain separate from RSRP and simulation outputs; CSV round trips preserve both. Censored/unknown-quality values remain inspectable while being excluded from carrier-power summaries.

The background study replays the original frozen v4-v6 simulation before evaluating each observed cell at its actual GPS. It reuses the engine's complete-cell, original sampled-grid, receiver, far-field and all-RAT budget rules. Missing quality/power/carrier/GPS, instrument-range violations, route mismatch and unsupported physics remain named exclusions. Source/instrument/configuration declarations remain independently unverified. The actual capture period governs validity; a virtual run's wall clock is not substituted.

One global dB offset is fitted on earlier, non-holdout sites, using equal 20 m cell/carrier/environment bins and linear-power averaging. Later reserved sites supply holdout bias/MAE/RMSE on the same supported raw/adjusted subset. Time gaps and wrong site/time combinations are quarantined; unseen carrier/environment combinations remain unscored. Software minima are 30 bins and two physical sites per cohort, with a default 90% compatible-reading requirement. Co-located frozen sites within 1 m cannot straddle the split. Nearby-site correlation and repeated holdout selection remain limitations; no confidence interval or automatic model update is claimed.

Durable idempotent jobs, cancellation/interruption handling, Task-scoped history, stale-form notices, bounded result pages and full frozen JSON exports are implemented. Polling does not transfer the complete trace. Full exports retain normalized captures and descriptor text, but cannot restore original CSV bytes. The queue permits ten active studies, 100000 observations/input, 128 KiB descriptors and 20 million route/replay/observed-port evaluations per stage.

The inventory and both Typst registers contain **199 matching features**, adding RF-29 measured power/quality, RF-30 compatibility and observed-cell prediction, RF-31 holdout diagnostics and RF-32 persistent study workflow/evidence. All 195 previous workbook review-status/note pairs are preserved. Saved full controlled-suite runs record 127 passes and four opt-in live-provider skips in each of Chromium, Firefox and WebKit. For this merge, 13 affected drive-test and field-validation workflows passed afresh in each browser, including LTE/NR, incompatible and invalid declarations, stale replies, cancellation/service errors, responsive layouts and a 100000-observation export. The full core check passes after an additional numeric-validation fix; oversized integer descriptors and split options now return validation errors, with calibration, descriptor and HTTP regression coverage. Live-provider and real-field validation remain separate from these software checks.

These tests use explicitly fabricated software contracts and analytic offsets. Real operator measurements, independently checked instrument/configuration records and untouched field holdouts are still required. The prediction engines and existing simulated captures remain uncalibrated and immutable.

## Remaining enhancement plan

| Priority | Next work | Acceptance criteria and evidence needed |
|---|---|---|
| P1 | Independent equipment and vendor-model verification | Compare actual imported configurations against operator/vendor hardware identifiers, port/reference conditions and dated electrical states. The numerical full-sphere contract is implemented; verify real exports against an independent tool and suitable antenna evidence before claiming vendor or field accuracy. Retain qualification status and source records. |
| P1 | Complex polarized source/channel and coherent panel modeling | The explicit Model-2 LOS reference receiver is implemented below. Remaining work requires polarized vendor fields, NLOS cross-polar transfer, panel phase-center geometry, inter-port phases/correlation and appropriate receiver processing before coherent combining or MIMO claims. Validate independent channel/power/geometry oracles and preserve prior uncorrelated/LOS engine identities. |
| P1 | Real field calibration and independent validation | The declared-input compatibility, frozen replay, observed-cell GPS prediction and chronological/site-separated diagnostic workflow is implemented below. Collect suitable actual operator measurements and instrument/configuration evidence, independently verify their definitions and evaluate untouched holdout sites before claiming measured accuracy. Synthetic/license data remain ineligible. |
| P2 | Terrain, buildings and clutter | Specify coordinate/height datum, terrain resolution, obstruction/clutter provenance and propagation domains. Validate independent known paths and holdout measurements before coverage maps or optimization use them. |
| P2 | Reference-signal and interference models | Define LTE/NR resource/power mapping and co-channel activity/load before RSRP/SS-RSRP or SINR. Reject incompatible metric comparisons and disclose missing neighbor/channel data. |
| P3 | Constrained optimization | Introduce explicit objective, demand, allowed changes, power/hardware constraints and uncertainty only after the applicable model is validated. Require reviewable proposed changes and reproducible before/after evidence. |
| P3 | Operational twin freshness | Connect operator configuration/telemetry with observation and retrieval timestamps, versioned identity and stale/missing-state handling. Delayed data must never appear as verified current operation. |

Real equipment/pattern files and compatible measured captures/endpoints were requested earlier and remain unavailable in the local application. Software workflow and model validation can progress; field calibration, verified deployment and operational freshness require those inputs. The local registry contains existing simulated/synthetic demonstrations, not a measured network validation set.

## Published LOS receiver validation checkpoint

At the published LOS receiver checkpoint, the workbook and both Typst registers contained **195 matching features**, adding RF-26 explicit Model-2 LOS collection, RF-27 versioned receiver execution and RF-28 receiver review/evidence. All 192 previous review-status/note pairs were preserved. Both Typst documents compiled; every changed workbook/register row, receiver section, desktop/phone dialog and printed source/receiver report was rendered and visually inspected.

TDD covers analytic alignments/nulls, reciprocity, poles, passive dual collection, an independent Euler-matrix/local-spherical oracle and 180 deterministic cross-language vectors. A four-element analytic array null verifies mechanical roll. Six Python source-grid/array member runs verify frozen v6 replay alongside the 14 historical member oracles. Zero ports do not invalidate other usable power; a blocked parent still exposes zero only as a standalone component. Explicit-null receivers and missing frozen source assumptions fail before publication. A regression first reproduced scalar A being published before invalid grid B; complete snapshot validation now prevents that partial result.

The full core check passes with the MVVM guard retained. Its existing POSIX mode-bit test is explicitly skipped on Windows because those bits do not represent Windows ACLs. Browser validation covers **125 distinct cases per browser**: 121 controlled workflows and four separately enabled live-provider cases. No automatic retries or accessibility-rule exclusions are enabled.

| Browser | Complete controlled suite | Separate live-provider suite | Final affected receiver/RF workflows |
|---|---|---|---|
| Chromium | 121 passed, 4 opt-in skips (14.4m) | 4 passed (29.8s) | 12 passed (1.3m) |
| Firefox | 121 passed, 4 opt-in skips (8.9m) | 4 passed (19.9s) | 12 passed (1.2m) |
| WebKit | 121 passed, 4 opt-in skips (10.5m) | 4 passed (16.6s) | 12 passed (1.4m) |

The initial Chromium full run exposed one stale assertion after the rebuild notice was expanded to include polarization. The expected notice was corrected, then all complete suites passed. Subsequent UI review reproduced a blocked receiver loss being labeled scalar zero, and exact zero loss displaying a minus sign. The final RF-only formatter now distinguishes not-evaluated paths from scalar baseline collection and displays nonnegative zero; project guidance also reflects an already selected project. All 12 affected receiver/RF workflows passed in each browser after those display changes. Physics, stored inputs and execution behavior were unchanged by that final UI clarification.

The receiver cases exercise clean cancellation, stale project protection, hidden dual-orientation recovery, LTE/NR source-grid plus array ports, save/reload/apply/execute/export/report, entirely zero valid members after unchanged comparison acceptance failure, blocked-parent/zero-component distinctions, WCAG A/AA and 320-1440 px geometry, and 100000 receiver observations with responsive worker computation and complete export. Print review corrected an orphaned budget heading and a split power column; the final heading/table and power units stay together.

Before publication the actual registry contains six captures (four simulated, two synthetic, zero measured), two completed jobs, no active jobs and nine projects without operator equipment imports or saved scenarios. Disposable fixtures supply the qualified equipment workflows. A separate read-only viewer/registry audit follows publication; these software tests do not establish measured network accuracy, verified vendor fields or live deployment.

## Previous RF result validation checkpoint

The workbook and both Typst registers contain **192 matching features**, adding RF-23 frozen cell/port overlays, RF-24 paired domain/sensitivity diagnostics and RF-25 responsive worker/evidence review. All 189 existing review-status/note pairs are preserved. Both Typst documents compile; every changed workbook/register row, new design section, desktop/phone map and printed RF summary has been rendered and visually inspected.

Model and ViewModel red/green tests cover the five frozen engines against 14 canonical Python member runs, including deep-null output gating and paired RAT-assignment membership changes. They verify complete-cell versus standalone-port status, exact paired grids, both-side unsupported reasons, replay/source-hash refusal, explicit sensitivity, cancellation, source changes and late replies. The full core check passes with the existing MVVM dependency guard retained; lightweight summary arithmetic is separated from worker physics.

All **118 distinct cases per browser** are covered: 114 controlled workflows and four separately enabled live-provider cases. No automatic retries or accessibility exclusions are enabled.

| Browser | Complete controlled suite | Separate live-provider suite |
|---|---|---|
| Chromium | 114 passed, 4 opt-in skips (13.5m) | 4 passed (33.7s) |
| Firefox | 114 passed, 4 opt-in skips (8.2m) | 4 passed (18.1s) |
| Webkit | 114 passed, 4 opt-in skips (9.6m) | 4 passed (17.7s) |

The Chromium full suite preceded the final RF-only live-map sizing/label-fit corrections. All five affected RF workflows then passed on the final source (26.2s); the complete Firefox/WebKit suites include those corrections. The existing replay sizing and fit behavior retain their defaults.

Visual review first exposed a zero-height RF live-map container despite existing marker DOM nodes, then a clipped phone label. New assertions reproduce both failures and verify map/canvas dimensions plus complete label bounds after Fit at 320/390/768/1440 px. Final screenshots show the route, selected observation and frozen label. A native WebKit direct-click regression also reproduced input-blur rendering that replaced pressed button text; unchanged labels are now retained without adding an extra user action.

The five RF browser workflows exercise LTE/NR frozen source use after inventory replacement, cell-incomplete paths, valid paired deltas, sensitivity and full JSON/report export, worker cancellation with a held late script response, incompatible/unreadable reference recovery and all 100000 observations with UI responsiveness. Source-grid and legacy physics remain uncalibrated planning power; software verification is not measured network accuracy.

Before publication, the actual local registry baseline contains six captures (four simulated, two synthetic, zero measured), two completed jobs, zero active jobs and nine projects with no operator equipment imports or saved scenarios. Disposable test fixtures supply the equipment/model workflows; no demonstration is presented as verified deployment. Publication is followed by a separate read-only check of the running viewer and registry identity.

## Previous source-pattern validation checkpoint

The required feature inventory and both Typst registers contain **189 matching features**, including RF-20 scalar-model qualification, RF-21 frozen prediction and RF-22 model evidence review/reporting. All 186 previously recorded review-status/note pairs are preserved. Both Typst documents compile; changed workbook rows, new document sections, mobile/desktop dialogs and the model report have been rendered and visually inspected.

TDD demonstrated the absent model/API/UI/report contracts before implementation. Independent closed-form power/interpolation/integral tests, a moving-frequency-lobe bound, 103 deterministic JS/Python gain/rotation vectors, source/hardware/port checks, sample limits, queued immutability, old saved-library/frozen-model refusal and both-side A/B budget preflight now pass. The full core check passes. All six focused Chromium workflows pass: LTE/NR save/reload/apply/run/report/export, hardware mismatch, cut-only refusal, historical source rebuild and inert unrecognized historical-v1 fields. Grid-baseline/reference-element A/B is also exercised for LTE and NR; a formatter regression first reproduced an incorrect Isotropic label and now checks the correct grid identity.

All **113 distinct cases per browser** are covered: 109 controlled workflows and four separately enabled live-provider cases. The owning CLI processes completed successfully, with no automatic retries or accessibility-rule exclusions.

| Browser | Complete controlled suite | Separate live-provider suite |
|---|---|---|
| Chromium | 109 passed, 4 opt-in skips (13.0m) | 4 passed (31.8s) |
| Firefox | 109 passed, 4 opt-in skips (7.7m) | 4 passed (21.4s) |
| WebKit | 109 passed, 4 opt-in skips (9.1m) | 4 passed (19.8s) |

The complete Chromium suite preceded the final comparison-label/saved-version polish; all 14 affected array, cell, grid and scenario-comparison cases then passed on the final implementation. Its one reservation readiness case also passed after the test-harness correction below. Complete Firefox/WebKit suites include those final changes.

The first Firefox suite passed 108 workflows and exposed one existing reservation-test race: it read a private MapLibre cache before source marker data was ready. The test now waits for loaded markers through the public source query, preserving its close/reopen, visibility and checkbox assertions. That case passed explicitly in Firefox and Chromium before the complete Firefox rerun and WebKit run. This is a readiness correction, not a retry or weaker assertion.


The published source-cell predecessor passed 103 controlled and four separately enabled live-provider cases per browser. The pinned Playwright 1.63.0 environment retains every accessibility rule and no automatic retries. Windows WebKit uses separate spec projects to bound WebGL state carryover. Windows Chromium retains pinned default feature switches plus the upstream TCP-port-randomization fix. These are managed test-launch settings, not application/user-browser changes. Software tests and observed provider availability are not field prediction accuracy.

## Primary references

- [Forsk Atoll overview](https://www.forsk.com/atoll-overview): workflow reference for multi-RAT planning, equipment, predictions and measurement integration; no equivalence claim.
- [3GPP TR 38.901 v18.0.0](https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/18.00.00_60/tr_138901v180000p.pdf): pinned reference-element/array engineering subset and UMa mean-path-loss basis, with disclosed fixed-height/domain limits.
- [TS 36.104 v18.5.0](https://www.etsi.org/deliver/etsi_ts/136100_136199/136104/18.05.00_60/ts_136104v180500p.pdf) and [TS 38.104 v18.5.0](https://www.etsi.org/deliver/etsi_ts/138100_138199/138104/18.05.00_60/ts_138104v180500p.pdf): pinned Release 18 downlink carrier subset, not complete base-station conformance.
- [NASA GT-TE-2402](https://extapps.ksc.nasa.gov/Reliability/Documents/Preferred_Practices/2402.pdf), Technical Rationale page 3: conventional far-field separation basis. The application uses its assumed array diagonal and does not claim antenna measurement accuracy.
- [Playwright fix 43605](https://github.com/microsoft/playwright/pull/43605): Windows Chromium socket-allocation test-launch backport.

- [ANSYS HFSS 2026 R1 realized gain](https://ansyshelp.ansys.com/public/views/secured/electronics/v261/en/subsystems/hfss/Content/HFSS/PeakRealizedGain.htm): incident-power reference and power-wave convention context. This format requires a real reference impedance and matched other ports; arbitrary complex normalization is unsupported.
- [MIT 6.013, Chapter 11](https://ocw.mit.edu/courses/6-013-electromagnetics-and-applications-spring-2009/MIT6_013S09_chap11.pdf): gain/power and far-field engineering basis; the application validates its explicitly defined interpolated scalar field.
