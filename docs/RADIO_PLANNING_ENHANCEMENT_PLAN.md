# Radio planning workflow review and enhancement plan

Review date: 13 November 2026. Scope: the local NDT application, its Toronto ISED inventory, New York reservation context, and integrated drive-test workspace.

The target workflow is: choose region and project → review inventory and missing inputs → define a versioned radio scenario → run a prediction → compare against a baseline and measurements → retain a reproducible report. The application already has project membership, Task routes, imported capture analysis, and isotropic power A/B. Its next stage needs a reliable equipment and scenario model before extending prediction outputs.

## Findings and changes delivered

| Finding | Delivered behavior | Remaining constraint |
|---|---|---|
| Outdoor inventory disappears when a fan cannot be calculated | Every enabled licensed location remains a selectable marker | Licensing does not establish operating status |
| Map symbols do not identify sites or projects | Clickable provider/site-ID labels at zoom 13+, selected-site label, and named project clusters | Labels are limited to 45 items, avoid nearby labels, and respect layer enablement; labels are a display control |
| Project membership is difficult to inspect | Project/cluster context in the inspector, membership in site facts, direct site review from Project Overview | One existing membership list is treated as the project's planning cluster; independently named clusters are not implemented |
| Inventory details are long and flat | Site → reported bearing/non-directional group → reported records, with all/LTE/NR filters | Bell data aggregates multiple records; physical cell/radio/antenna connectivity cannot be reconstructed |
| Antenna assumptions cannot be exercised | Editable LTE/NR study presets and an isotropic or reference-element single-link probe with azimuth/downtilt | Independent study; not assigned to deployed equipment, map fans or virtual-drive jobs |
| Right panel combines controls, inventory and caveats | Summary facts first; separate expandable search, topology, study, display assumptions and source details | Existing Task and UE editors retain their workflows |
| Study edits are easily lost | Named SQLite project scenarios with immutable revisions, per-site overrides, baseline/applied pointers and JSON export; region-only browser saving remains | Applied revisions are tracked in the library; probes use editable inputs and virtual-drive integration is pending |

The reference element uses TR 38.901 v18.0.0 table 7.3-1 (65° horizontal and vertical beamwidth, 30 dB attenuation caps, default 8 dBi peak gain), combined with the existing fixed-height UMa mean-path-loss implementation. Positive tilt rotates the element boresight downward. Peak EIRP = conducted TX power + peak gain − feeder loss. Probe received power = peak EIRP − directional attenuation − path loss. There is no array factor or service simulation. RAT and bandwidth are recorded metadata. Radio preset values are engineering assumptions, not standardized deployment settings or verified site values.

## Prioritized remaining work

The remaining scope is listed below. The scenario library component is implemented; its run integration remains pending. Other work packages remain planned.

| Priority | Work package | Design and dependencies | Acceptance criteria |
|---|---|---|---|
| P1 | Verified equipment inventory | Introduce stable Site, Sector, Cell/Carrier, Radio, Antenna and port/link IDs. Retain raw source IDs, provenance and observation date. Import operator configuration and vendor antenna patterns. Separate unknown from zero and reported from assumed. | One LTE/NR site can be traced from carrier to radio/antenna with explicit source evidence. Duplicate IDs and broken links produce actionable import errors. Aggregate Bell records never become invented cells. |
| P1 | Durable scenario and template library | Implemented: named SQLite revisions, template/site overrides, draft/baseline/applied state, conflict recovery, source identity and input validation. Remaining: connect the applied revision and complete inventory snapshots to frozen run manifests. | Library save/reload, concurrent-write and conflict tests pass. A run manifest freezing equipment, scenario and source versions is still required. |
| P1 | Directional route prediction | Extend Python/JS parity to directional antenna models, per-transmitter carrier and orientation. Keep peak EIRP/gain accounting consistent. Apply the same frozen scenario in virtual drives and A/B. | Zero-change A/B agrees; rotating a sector changes only relevant predictions; browser and backend agree on boresight, rear, tilted and model-limit probes. Existing jobs remain reproducible under their original model version. |
| P1 | Standards and input validation | Select LTE/NR release and supported band/channel combinations using TS 36.104 and TS 38.104. Define power convention, bandwidth, duplex, numerology and reference signal assumptions. | Invalid band/frequency/bandwidth combinations cannot launch supported technology-specific simulations. UI identifies the exact missing or incompatible input. |
| P2 | Independent project clusters and inventory table | Support named clusters within a project, member counts, bounds and table/map selection synchronization. Replace right-click-only membership editing with visible add/remove actions. | Keyboard and touch users can select and edit membership. Labels identify both project and independently named cluster. Large inventories support sorting and filters without expanding a long panel. |
| P2 | Calibrated RF predictions | Add validated terrain/clutter/building treatment and measured calibration before coverage claims. Add same-channel interference and load models before SINR; define resource/power mapping before RSRP/SS-RSRP. | Holdout measurement error and coverage are reported by band/environment. Each output has a metric definition, input provenance and supported-domain warning. |
| P2 | Planning results and comparison UX | Separate scenario setup from results, mark stale results after edits, expose only actionable failures, and link map, KPI summary and findings. | A user can identify the active scenario, affected sites, run status and baseline differences without reading raw manifests. Exports retain full details and model/source versions. |
| P3 | Optimization and operational twin | Add constraints, demand/traffic, neighbor relations and handover only after validated radio inputs; connect operational updates with timestamps and freshness checks. | Suggested changes state objective/constraints and can be reviewed before applying. Delayed operational data cannot appear as current network state. |

## UI/UX rules for follow-on work

- Keep region, project, cluster and selected site visible near the work area. Use persistent selection and explicit empty/loading/error states.
- Put identity, RAT, membership and important model/input issues above expandable technical records. Missing operational data is an inventory limitation, not a paragraph repeated beside every control.
- Distinguish source data, editable assumptions and calculated outputs through labels and layout. Do not present guessed cell connectivity or technology-specific KPIs as measured facts.
- Preserve the map while inspecting details; keep controls reachable at 320 px width. Use labeled controls, visible keyboard focus, Escape dismissal and touch alternatives for editing.
- Keep baseline/current inputs and comparison scope explicit. Results must name their metric and units; details belong in the exported manifest or expandable model scope.

## Verification

The change adds numerical reference-element and link-budget checks, real-data inventory grouping checks, browser workflow coverage, template save/reload/export checks, accessibility checks and responsive geometry checks. The existing project, network and drive workflows remain regression targets. Deterministic browser tests use a controlled basemap; they do not qualify external providers or field RF accuracy.

Initial-phase validation: `./make.ps1 check` passed, including Python/JavaScript radio-model parity (one existing platform-specific Python case was skipped). The 35 existing application browser cases and three planning workflow cases passed in Chromium, including axe accessibility and 320–1440 px layout checks. Both Typst documents compiled and the initial 173 feature rows matched the workbook.

Scenario-library TDD: storage tests first failed for the missing module, then passed for restart persistence, immutable versions, baseline/applied pointers, stale and parallel writers, source changes, validation, same-origin access and project isolation. View-model tests first failed for the missing implementation, then passed for stale loads and conflict draft retention. Playwright first failed for missing library controls; the completed workflow passed with two browser clients, conflict copying, reload, accessibility and responsive layouts. A separate per-site override test failed for the absent action, then passed after the editor was implemented. The documentation register now contains 174 matching feature rows; existing workbook review notes remain intact. The full Playwright suite is being verified as part of this goal. Live provider qualification and field calibration remain outside the completed evidence.

## Primary references

- [Forsk Atoll overview](https://www.forsk.com/atoll-overview): multi-RAT planning, prediction/measurement integration, propagation, equipment databases and reporting inform this workflow review. NDT does not implement Atoll-equivalent capabilities.
- [3GPP TR 38.901 v18.0.0 via ETSI](https://www.etsi.org/deliver/etsi_tr/138900_138999/138901/18.00.00_60/tr_138901v180000p.pdf): the implementation pins this edition's reference element and UMa mean path-loss equations. This is a limited model implementation, not a claim of full 3GPP conformance.
