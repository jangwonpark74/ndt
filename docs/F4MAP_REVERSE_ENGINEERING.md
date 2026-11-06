# F4 Map: OSM 3D visualization investigation

Investigated 2026-11-07. Target: [F4 Map, Toronto](https://demo.f4map.com/#lat=43.6458420&lon=-79.3870592&zoom=16). This is an investigation and reconstruction design, not an implementation or a claim of source-code equivalence.

## Evidence and coverage

REA MCP `capture_browser_scenario` launched a temporary Chromium browser, navigated to the target and observed it for 15 seconds. Evidence ID: `ev_bb994fa8ee5b85db62980dc41beaab04554ac4da7bfcd5ada8d44394aa4ad2a9`. REA reports complete capture within that window, 761 retained events and none dropped, two workers created, and no page errors. Its browser process was terminated afterward. The capture did not include response bodies, screenshots, or request initiator stacks; it does not establish that all resources finished loading or that any particular payload was rendered. A separate raw evidence export was kept in temporary storage because it contains ephemeral session identifiers.

Observed network activity in that window included 40 HTTP 200 responses for each of these URL patterns:

| Endpoint pattern | Observation | Plausible role, not decoded |
| --- | --- | --- |
| `buildings.f4map.com/buildings/16/{x}/{y}.json` | Successful JSON-named tile requests | Building geometry and attributes |
| `geo.f4map.com/queries/details/16/{x}/{y}` | Successful detail tile requests | Other mapped features |
| `tile.f4map.com/tiles/f4_3d/16/{x}/{y}.png` | Successful PNG tile requests | Ground imagery |

There were also successful requests for `.bis` model assets and PNG textures under `core.f4map.com`, plus Socket.IO polling against `watcher.f4map.com`. Forty building requests were aborted as well as a separate successful set; the cause is unknown. The names and extensions alone do not prove payload schemas, coordinate encoding, cache strategy, or the roles of individual requests.

The page declares an OSM-based WebGL viewer. The captured DOM contains a main scene canvas and multiple positioned label canvases; controls expose ground elevations, weather, time of day, traffic, urban and natural details, water reflections, dynamic shadows, and ambient occlusion. Control presence does not prove each feature was exercised or rendered successfully.

A separate REA screenshot capture (`ev_6b367fab28cefba5d4e0da35fdc4212a34f58a5d971e8cd6f5f7756d41ab2a51`) produced [the Toronto reference image](images/f4map-toronto-rea.png), 1280 × 800. It visibly shows an oblique 3D city with building geometry, ground imagery, shadows and labels. SHA-256: `183c28e14db2a6fa553a953efa724983b4fecf9804d8d937bcb08abf34d4cf51`.

In a further focused capture (`ev_9b4a1dcd6ad989286624c6be79cd38e5a016292d7120f4af33508fcb31fa6053`), building request parameters included `straightSkeleton=1` and `skipOsmBuildingsOverlappingModels=true`, along with two model-mapping URLs. Detail queries included OSM-like tag filters for features such as trees, lamps and barriers. These are requested options, not proof of how the server computes them. Event coverage for this second capture was incomplete. The 404 observed in the first capture was for `/static/i18n/translation.en-US.json`; the English fallback `/static/i18n/translation.en.json` succeeded. The cause of the 404 was not established.

## What F4 documents

F4's [3D rendering documentation](https://wiki.f4map.com/render) describes the following design; its publication date and correspondence to the currently deployed build are not established:

- Ground shading is generated as tiles using TileMill and Mapnik over OSM data. Elevation is described as distance-adaptive, using DEM3 data at up to 90 m precision.
- Buildings use [Simple 3D Buildings](https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings). F4 documents inheritance of building tags by contained parts, subtraction of parts from the outline in specified cases, `height` precedence, a fallback of 3 m per `building:levels`, and a deterministic semi-random fallback derived from the way ID when neither is present.
- Roof generation supports multiple `roof:shape` values. F4 documents straight skeletons for ridge generation, oriented bounding boxes for `roof:orientation`, and facade height equal to total height minus roof height. Material and colour tags drive appearance.
- Natural and urban details use a mix of OSM geometry, procedural placement and specific models. Some landmark buildings come from a separate proprietary model database.

F4's [changelog](https://core.f4map.com/changelog) records per-tile modeled-building retrieval and a compact building format in 2018, cascaded shadow maps in 2015–16, and screen-space ambient occlusion changes. These are historical vendor statements, not measurements of the current rendering pipeline. The 2025 changelog also records a skillion roof change, illustrating why the undated render documentation should not be assumed current in every detail.

## Independent reconstruction design

The following is an engineering proposal informed by the observations, not F4's recovered source or exact implementation.

1. **Ingest and normalize OSM.** Use a dated regional extract and retain OSM IDs, tags, multipolygon rings and building relations. Resolve building outlines and parts explicitly, including holes, disconnected geometries and relation membership. Avoid drawing both an outline and overlapping parts as duplicate volumes; choose and document a policy for uncovered outline areas. Preserve raw tags and record whether every height is measured, derived from levels, or estimated.
2. **Create spatial tiles.** Project to a consistent metric coordinate system or tile-local coordinates. Index features by tile and include enough buffer for features crossing edges; deduplicate by stable OSM identity. Build and serve versioned, cached vector or precomputed mesh tiles. Preserve geographic coordinates for navigation and attribution.
3. **Generate geometry.** Extrude building footprints from `min_height` to the wall top; triangulate roofs and holes. Interpret `height` as total height, including the roof, and use `roof:height` to find the wall top. Support flat roofs first, then implement and test gabled, hipped, pyramidal and skillion roofs, with explicit fallback for unsupported or invalid shapes. Orient roofs from tags where present and use a robust geometry algorithm for concave polygons. Handle unit parsing and malformed tags explicitly.
4. **Render the scene.** Use WebGL with a map camera, textured or vector ground, tiled building meshes, a lighting model, shadows and optional ambient occlusion. Add terrain only after validating the elevation source, datum and alignment with buildings. Add trees, street furniture and water as separate, controllable layers, using stable seeded placement for generated details. Treat generic textures and landmark assets as separately licensed inputs.
5. **Validate.** Compare the same location, zoom, camera, time and options against the reference using browser screenshots. Test building outlines and parts, holes, concave roofs, heights and units, tile boundaries, missing tags and reloads. Measure load time, draw calls and memory across camera movements. Check a few OSM objects against their source tags and label inferred heights visibly in inspection tools.

One feasible stack is MapLibre GL JS for navigation and ground tiles with a Three.js custom rendering layer for procedural buildings and details, backed by an OSM processing and tiling pipeline. This is a proposed implementation choice, not a finding about F4's stack. A simpler building-extrusion prototype would be useful for validating the data path before investing in roof meshes and effects.

## Open questions

- What do the building and detail responses actually contain, and which tags survive preprocessing? No payload body was captured or decoded.
- Which WebGL engine, shaders, projections, mesh formats and geometry algorithms are active in this build? The capture alone cannot answer this.
- Which particular Toronto buildings are proprietary landmarks, and which heights are OSM values versus estimates? No feature-level inspection was performed.
- How do camera movements, zoom changes and option toggles affect requests and scene appearance? The initial load alone cannot establish interaction behavior.
- What caused the aborted requests? They require a focused follow-up before interpretation.

For an independently built product, use OSM data with the required [attribution and ODbL notice](https://www.openstreetmap.org/copyright), and review the license and usage policies for each additional data, tile, model and texture source. OSM's data license does not grant rights to F4's proprietary code or assets.
