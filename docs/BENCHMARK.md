# Toronto waterfront: F4 Map benchmark and implementation plan

## Reference and method

Reference: [F4 Map at 43.6394193, -79.3922155, zoom 17](https://demo.f4map.com/#lat=43.6394193&lon=-79.3922155&zoom=17), inspected on 2026-11-07 in a live Chrome view. The Harbourfront shortcut in this viewer centers on the same coordinates and uses zoom 17. The two applications use different cameras and zoom conventions, so this is a qualitative comparison, not a pixel-matched or frame-rate benchmark. The attempted REA controlled browser capture timed out during cleanup; the reference observation came from the live browser.

The reference view visibly includes individual trees and rows around streets and parks, opaque 3D buildings and distinctive landmarks, detailed ground and railway styling, building shadows, and textured water. F4's [rendering documentation](https://wiki.f4map.com/render) describes OSM trees, generated tree rows, OSM building tags, and separately modeled proprietary landmarks. The documentation may not describe every detail of the current deployment.

## Changes implemented

| Priority | Observation | Implementation |
| --- | --- | --- |
| 1 | The previous viewer lacked 3D trees. | Render mapped `natural=tree` nodes and estimated points along mapped `natural=tree_row` ways as terrain-aligned Three.js instances. Tiles load on demand across the Toronto extract. |
| 2 | Users needed a repeatable comparison location. | Add a Harbourfront shortcut centered on the supplied coordinates. |
| 3 | The previous native buildings appeared translucent. | Use opaque tile-based building extrusions while retaining OSM building colors and the existing custom roof layer. |
| 4 | Individual trees are too dense to draw as 3D objects at city scale. | Show only unclustered points at overview zooms; switch to individual 3D trees at zoom 15. |

The fixed 2026-10-31 BBBike OSM extract contains **54,879 individually mapped tree nodes** and **5,113 inferred row positions** after a two-metre deduplication rule. A defined waterfront sample window, 43.634–43.645° N and 79.400–79.384° W, contains **672 mapped tree nodes**. This is an extract count, not a count of visible trees in either screenshot or a survey of every real tree. Dimensions absent from OSM use illustrative defaults; row positions are inferred and are not individually mapped observations.

## Visualization enhancement pass

The viewer now includes concave gabled roofs, flat and skillion courtyard geometry, and mapped multipolygon relations in the fixed roof extract. In the sampled Toronto tile, way IDs with suffixes `0` and `2` and relation IDs with suffix `3` matched the OSM objects; this mapping is provider-specific. Roof replacement still waits for valid geometry and does not replace hidden or unmatched tile features. The refreshed extract contains 18,758 ways and 21 relations. F4's separately modeled landmarks cannot be inferred from OSM alone.

MapLibre and Three.js use a fixed southeast light, water receives a subdued color treatment, and the optional shadow layer projects building footprints away from the light. Those effects are illustrative: projected shadows do not solve terrain or inter-building occlusion, and remain off by default. Tree crowns vary deterministically, with extra detail fading by distance. Mapped lamps and benches are drawn as simple models near the camera at zoom 17 or closer; their positions come from OSM, but dimensions and orientation are illustrative. The layer is bounded to 1,000 items within 1.2 km.

In one warm-cache Chrome session on 2026-11-07, an earlier version of the viewer measured five seconds of forced redraws at a 2560 × 1259 CSS-pixel viewport and device pixel ratio 2.5. Harbourfront with terrain, roofs, trees and street details enabled and shadows off produced 300 frame intervals, median 16.6 ms and p95 18.9 ms, with 126 MB of reported JavaScript heap. Map first idle was 0.87 s after navigation; custom data can still load after that event. This is a single historical observation, not a performance guarantee, a cold-load measurement, or a comparison with the current version. Frame intervals include display scheduling; JS heap excludes GPU and other process memory. No performance budget is asserted from a single run.

## Validation boundary

`make check` exercises roof geometry, courtyard and concave fixtures, shadow projection, tree dimensions, extraction sampling, tile selection, street-data integrity, and the fixed waterfront tree count. Browser inspection can confirm rendered layers and controls but does not prove city-wide OSM completeness. A fair comparison would require the same viewport, camera, browser, hardware, cache and network conditions, and measurement procedure.
