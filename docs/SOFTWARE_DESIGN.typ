#set document(title: "Regional NDT Viewer - Software Design", author: "Toronto NDT project")
#set page(paper: "a4", margin: (x: 21mm, top: 22mm, bottom: 19mm),
  header: context text(size: 8pt, fill: rgb("647c72"))[TORONTO NDT  /  SOFTWARE DESIGN],
  footer: context align(right, text(size: 8pt, fill: rgb("647c72"))[#counter(page).display()]))
#set text(font: ("Arial", "New Computer Modern"), size: 9.7pt, fill: rgb("1c3030"))
#set par(leading: 0.65em, spacing: 0.78em)
#show heading.where(level: 1): set text(size: 16pt, weight: "bold", fill: rgb("174c3b"))
#show heading.where(level: 2): set text(size: 11.5pt, weight: "bold", fill: rgb("285e4c"))
#set heading(numbering: "1.1")
#set table(stroke: 0.5pt + rgb("cbd9d1"), inset: 5pt)

#text(size: 9pt, weight: "bold", fill: rgb("54806b"))[AS-BUILT DESIGN  /  07 NOVEMBER 2026]
#v(7mm)
#text(size: 27pt, weight: "bold", fill: rgb("173c30"))[Regional NDT Viewer]
#v(2mm)
#text(size: 18pt, fill: rgb("517465"))[Software design document]
#v(5mm)
#line(length: 100%, stroke: 1.3pt + rgb("6f9a7d"))

*Baseline.* Git revision `836eec2` of `toronto-ndt`, including the subsequent individual-site SQLite storage update. The document describes the implementation, not an intended architecture. Source references identify the authoritative code. In particular, no calibrated RF simulator, authentication service, server-side job queue or multi-user conflict resolution is implemented.

#table(columns: (1fr, 2.5fr),
  [*Runtime*], [Python 3.14 or later; browser JavaScript modules; MapLibre GL JS and Three.js bundled in `ndt/dist/vendor/`],
  [*Application source*], [`ndt/dist/` is checked-in application source and data, not a disposable build directory.],
  [*Persistence*], [SQLite in project-root `regions.sqlite3` by default; local prepared source datasets are inputs.],
  [*Entry points*], [`make run` -> `ndt/server.py`; browser -> `ndt/dist/index.html` and `app.js`.],
)

= Architecture

== System context and data flow

#block(fill: rgb("edf4ee"), inset: 10pt, radius: 3pt)[
  *Browser*\
  MapLibre map + Three.js custom layers + `app.js` controller\
  #text(fill: rgb("54806b"))[↓ HTTP: region catalog, assets, project membership]\
  *Python `ThreadingHTTPServer`*\
  Static files from `ndt/dist/` + JSON and asset endpoints\
  #text(fill: rgb("54806b"))[↓ SQLite reads / project-membership writes]\
  *SQLite database*\
  `regions` + `region_assets` + `network_datasets` + `network_sites` + `project_sites`\
  #text(fill: rgb("54806b"))[↑ startup import / asset refresh]\
  *Repository inputs*\
  `ndt/regions.json`, Toronto assets and New York assets
]

The browser also contacts OpenFreeMap for the map style and vector tiles, Mapterhorn for terrain and Photon for location search. Google Fonts is optional. These external services are separate from SQLite and are not covered by the local service's availability.

== Main components

#table(columns: (1.15fr, 2.3fr, 1.35fr),
  table.header([*Component*], [*Responsibility*], [*Source*]),
  [Application controller], [Region navigation, project state, controls, fetches, event handling, map sources and layers.], [`ndt/dist/app.js`],
  [Network and radio], [Site validation and drawing, bearings and fan geometry, UMa path loss and radius.], [`network-layer.mjs`, `network-symbols.mjs`, `radio-model.mjs`],
  [Project geometry], [Default site selection, haversine distance and sector convex hull.], [`project-coverage.mjs`],
  [3D detail layers], [Terrain-aligned roofs, trees, street details, marker and tower visualization.], [`roof-layer.mjs`, `tree-layer.mjs`, `street-detail.mjs`, `network-layer.mjs`],
  [NYC adapter], [Reservation filtering, search, selection and marker display.], [`nyc-reservations.mjs`],
  [Local service], [Static delivery, SQLite initialization and API handlers.], [`ndt/server.py`],
  [Data preparation], [Extracts and transforms ISED, NYC and OSM input data.], [`ndt/scripts/`],
)

= Region configuration and startup

The server binds before it initializes the database. Without `--port`, it tries 5179 through 5189 and advances only for an address-in-use error. An explicit port is exact. The default host is `127.0.0.1`. After optional migration, initialization reads `ndt/regions.json`, validates the presence of required region files, creates tables, updates region metadata and refreshes changed asset blobs.

Each region record contains an ID, display name, map center, zoom, pitch, project shortcuts, network adapter identifier, data root, roof file and network files. Toronto uses the `ised` adapter and assets under `ndt/dist/`; New York uses `nyc-poles` and assets under `ndt/data/new-york/`. Tree and street-detail directories are discovered recursively. The asset fingerprint hashes relative paths, file sizes and modification times, rather than file contents. If it changes, that region's asset blobs and individual network records are replaced together at startup. An invalid import rolls back the refresh. Existing project membership is not deleted by that refresh.

The browser retrieves `/api/regions`, selects the `region` URL parameter or defaults to Toronto, and builds the controls. A region switch assigns a new URL and reloads the page. On map load, the controller creates the sources and layers, starts the regional network adapter, and, for Toronto, loads all project clusters. The geographic style and terrain remain external runtime dependencies.

= Persistence and service contract

== SQLite schema

#table(columns: (1fr, 2fr, 1.4fr),
  table.header([*Table*], [*Fields and key*], [*Purpose*]),
  [`regions`], [`id` primary key; `metadata` JSON; `fingerprint` text], [Catalog and asset-refresh marker.],
  [`region_assets`], [`region_id`, `path`, `content` blob; composite primary key], [Region-specific imported files.],
  [`network_datasets`], [`region_id`, `path`, collection `metadata` JSON], [Network collection metadata; composite key.],
  [`network_sites`], [`region_id`, `dataset_path`, `site_id`, `ordinal`, `feature` JSON; generated `longitude` and `latitude`], [One complete source feature per site or reservation; region, dataset and site ID form the key.],
  [`project_sites`], [`region_id`, `project_id`, `site_ids` JSON; composite primary key], [Explicit project membership overrides.],
)

Network responses are assembled from the individual records in their original order; the original network blob remains as an imported snapshot. On upgrade, missing network tables are populated from the existing SQLite asset blobs when the region fingerprint is unchanged; otherwise the region is refreshed from source. Site coordinates are generated from the feature JSON and indexed with region and dataset. Startup validates site IDs and point coordinates. With an unchanged fingerprint, restart preserves the site records; a changed region asset triggers reimport of that region. The viewer has no site-details editing interface or audit history.

The default path is `regions.sqlite3` in the repository root. If that file does not exist and the legacy `ndt/var/regions.sqlite3` does, `migrate_database` uses SQLite's backup API into a temporary file and publishes it with a hard link. It does not overwrite an existing destination and retains the old file. An explicitly supplied `--db` path bypasses this default-path migration. Operators must stop older server instances before migration: an older process can continue writing its old file after the copy. Project edits are not reproducible from asset source files, so the SQLite database needs backup if edits must be retained.

== HTTP endpoints

#table(columns: (1.7fr, 1.7fr, 2fr),
  table.header([*Request*], [*Response / effect*], [*Validation and notes*]),
  [`GET /api/regions`], [JSON array of region metadata.], [Ordered by region insertion order.],
  [`GET /api/regions/{region}/assets/{path}`], [Network collection assembled from site rows, or stored asset blob, with inferred MIME type.], [Unknown region/path returns 404.],
  [`GET /api/regions/{region}/projects`], [Object mapping saved project IDs to site-ID arrays.], [Missing region returns 404; absent entries mean use the automatic default.],
  [`PUT /api/regions/{region}/projects/{project}/sites`], [Upserts the whole JSON array of site IDs; returns `{}` on success.], [ISED region and known project required; request size at most 100,000 bytes; at most 1,000 unique string IDs, all present in the region's Bell site records. Invalid lists return 400.],
)

The server validates that submitted IDs exist, not that each submitted site has three usable sector estimates. The browser applies the eligibility rule when presenting an add action. The server has no authentication, authorization, revision token or merge mechanism for concurrent edits. Two browser sessions can overwrite each other's project membership; the latest successful whole-list write wins. The default loopback binding limits the normal exposure, but a changed `--host` can expose the service to other clients.

= Browser state and project editing

The controller holds the selected project, a map of project clusters, a map of Bell features by site ID, an eligible-ID set and a set of projects with missing saved IDs. It shares a cached project-data promise and uses a request counter to avoid applying an earlier project selection after a later one. Saved membership overrides automatic selection; an explicit empty array remains empty. If a saved ID is absent from the loaded Bell dataset, the affected project's boundary and editing are disabled. The application does not silently discard the missing membership.

On a right-click over a Bell or selected-project marker, the controller resolves its site ID and opens a MapLibre popup. The action is add or remove according to current membership. The add button is disabled when the site is not eligible under the default radio scenario. A save serializes all current IDs for that project and sends a PUT request. The UI disables the action while the request is pending. After a successful response, it replaces the in-memory membership, regenerates all project boundary features, refreshes the selected-site markers and list, and fits the selected boundary. A failed request leaves the previous in-memory state in place and offers retry.

The project summary reports the current site count. Seven is the default selection and displayed simulation target, not a server-enforced membership constraint. A nonempty set of any size can have a boundary when every site has three usable full-radius fans for the current scenario. An empty set has no boundary. The repository implements a planning viewer and does not implement a simulation execution pipeline.

= Network geometry and radio model

== Reported records to fans

`bearingSummaries` groups directional records by valid transmit azimuth and collects their reported frequencies and horizontal beamwidths. A normal overview site must have exactly three bearings and a usable width at each bearing. For each bearing, `sectorFanFeatures` uses the widest valid reported beamwidth and the lowest valid frequency in the 500-100,000 MHz range. A fan requires a positive, valid calculated radius. The selected-site detail path can include sites with other bearing counts.

The display fan is drawn at 5/12 of the calculated radius and at least 15 degrees wide. For project boundary generation, `fullCoverage: true` uses the calculated radius and reported width instead. Both representations are sector wedges built from a center and geodesic arc points. Repeated bearings are grouped, so a bearing is not necessarily a unique physical cell or sector.

== UMa path loss and radius

`radio-model.mjs` implements the 3GPP TR 38.901 v18.0.0 urban macro mean path-loss equations. Fixed heights are base station 25 m, user terminal 1.5 m and environment 1 m. For LOS, the model selects the appropriate equation on either side of the frequency-dependent breakpoint; NLOS is the maximum of LOS and the NLOS equation. The received-power threshold is compared to assumed EIRP via `budget = EIRP - threshold`, with no extra receiver gain or additional losses.

The implementation uses distance in meters and frequency `f` in GHz for the following expressions. The breakpoint uses frequency in Hz and the speed of light `c = 3e8 m/s`:

```text
d3d = sqrt(d2d^2 + (hBS - hUT)^2)
breakpoint = 4 * (hBS - hEnv) * (hUT - hEnv) * frequencyHz / c
LOS before breakpoint = 28 + 22*log10(d3d) + 20*log10(f)
LOS after breakpoint  = 28 + 40*log10(d3d) + 20*log10(f)
                       - 9*log10(breakpoint^2 + (hBS - hUT)^2)
NLOS = max(LOS, 13.54 + 39.08*log10(d3d) + 20*log10(f)
                - 0.6*(hUT - 1.5))
```

Inputs are accepted only for LOS or NLOS, EIRP 0-90 dBm, threshold -160 to -20 dBm, frequency 0.5-100 GHz and distance 10 m-5 km. If the budget cannot reach 10 m the returned radius is zero; if it reaches 5 km, the result is capped. Otherwise a 48-iteration binary search finds the radius. A sector with a missing or zero-radius estimate is omitted. Defaults are NLOS, 46 dBm EIRP and -100 dBm threshold.

This is a uniform boresight link-budget illustration. It does not model site-specific heights, terrain or building occlusion, antenna-pattern loss, interference, traffic, shadowing, fading or penetration. It is not measured coverage, an RSRP/SINR calculation, or a calibrated network prediction.

== Seven-site default and enclosing boundary

1. Generate default-scenario fan features for the Bell dataset and count fans by site ID. Sites producing exactly three are eligible.
2. Choose the eligible site nearest the project center as the anchor, using haversine distance. Choose the six remaining eligible sites nearest to that anchor. Equal distances are resolved by site ID. There is no fixed cluster radius or global optimization.
3. For the current membership and selected radio scenario, generate all full-radius wedges. Reject the boundary if membership is empty or duplicated, or if any site does not produce exactly three usable fans.
4. Gather wedge polygon vertices, sort and deduplicate coordinates, and form lower and upper monotone chains with a cross-product test. Close the resulting convex hull as one GeoJSON polygon. The hull contains the fan vertices and can include gaps and uncovered space.

The four Toronto boundaries share a GeoJSON feature collection and are drawn with a 4 px dark green dashed line and a 6 px white halo. Project site markers are a separate GeoJSON source for the selected project. The selected boundary is fitted to a top-down view with padding for navigation, panel and camera controls. If planning inputs become invalid, affected boundaries are hidden; the selected site's markers remain available.

= OpenStreetMap-based 3D visualization

== Data sources and scene composition

The base layer is the OpenFreeMap Liberty style backed by OpenMapTiles vector data derived from OpenStreetMap. It supplies provider-selected and zoom-generalized features including buildings, transportation, water, land use, labels and points of interest. The application changes the water fill and groups style layers by source layer so building and street visibility can be controlled. OSM attribution is shown in the map. The tile schema and style do not expose every underlying OSM object or tag.

`app.js` adds a Mapterhorn raster DEM source using Terrarium encoding, 512-pixel tiles and a maximum DEM zoom of 12, then enables terrain at 1x exaggeration. Mapterhorn elevation data is separate from the OSM features. A terrain toggle disables the map terrain, and layer code uses zero ground elevation when terrain is off. Terrain queries can be unavailable while tiles load; the viewer reports terrain failures and skips affected detailed features until finite elevation is available.

The scene combines MapLibre-native fills, symbols and building extrusions with Three.js custom 3D layers for roof replacements, trees, street furniture, network towers and the map selection marker. Each custom layer shares the MapLibre canvas and WebGL context, uses the map's projection matrix, transforms a region-centered Mercator origin to local meter-scaled coordinates, and resets the renderer state before drawing. The layers do not constitute a separate photorealistic digital model.

== Prepared regional OSM datasets

Roof, tree and street-detail assets are prepared offline from dated BBBike OSM PBF extracts. `regions.json` assigns a data root and roof filename to each region; the server imports the roof JSON, tree manifest and tiles, street-detail manifest and tiles into `region_assets`. The browser retrieves them through region-scoped asset URLs. The live basemap and prepared extracts can have different update dates, extents, object IDs and coverage.

#table(columns: (1fr, 1.05fr, 1.05fr, 1.05fr, 1.05fr),
  table.header([*Extract*], [*Roof records*], [*Mapped trees*], [*Row estimates*], [*Lamps / benches*]),
  [Toronto], [18,779], [54,879], [5,113], [29,015 / 10,759],
  [New York], [14,768], [72,374], [6,074], [17,287 / 21,834],
)

Both PBF extracts are dated 2026-10-31. Counts are derived from the bundled roof and manifest files, describe extracted records, and are not a guarantee that the features appear in a given view. The New York extract extends beyond the five boroughs and is not clipped to city boundaries. Refer to `ndt/README.md` for source links and PBF checksums.

The extraction scripts use the pinned `osmium` dependency declared in their script metadata. `extract_roofs.py` writes a single JSON list of supported shapes and relevant tags. `extract_trees.py` writes an overview GeoJSON, a zoom-14 manifest and tiles. `extract_street_detail.py` writes a zoom-14 manifest and tiles. Tree and street output directories must be empty when rebuilt. To replace a region's assets, retain the relevant source and checksum, update its configured files, then restart the server so its asset fingerprint refreshes SQLite.

== Building extrusions and roof replacement

The MapLibre style's `building-3d` layer uses tile `render_height`, `render_min_height` and `colour` attributes when available. `roof-layer.mjs` loads the region's prepared roof file on demand at zoom 15 or above, then compares extracted OSM IDs to visible building source features. The implementation maps a way ID to suffix-derived tile IDs `id*10` or `id*10+2`, and a relation ID to `id*10+3`. These conventions were checked against a Toronto tile; provider changes or mismatches, including unverified New York matching, can prevent replacement. Ambiguous matches are not applied.

`buildRoofParts` checks geometry and height, derives building base and height from OSM tags, tile render properties or level-based fallback, and samples terrain at the roof footprint. For a supported pitched form, it creates Three.js wall and roof geometry and hides the original tile extrusion only after replacement geometry is ready. A flat roof with a mapped color or material uses a thin color overlay and retains the native building. Unsupported or invalid geometry, missing height, unmatched IDs, failed loading or unresolved elevation leave the native flat extrusion in place.

`roof-geometry.mjs` supports skillion, gabled, hipped, pyramidal, dome, cone and onion shapes; extraction maps `shed` to skillion and `pitched` to gabled. Direction can come from numeric or compass `roof:direction`, or orientation and an inferred minimum-area footprint frame. Roof height is taken from a valid explicit height, levels or angle when available, then from a bounded estimate. Concave skillion and gabled footprints are handled; flat and skillion polygons can retain holes. Hipped geometry is limited to suitable four-corner footprints, and unsupported holes or concavity for other pitched shapes fall back. Colors are parsed from supported OSM color names or hex values, or selected from a material palette and fallback colors.

== Tree extraction and rendering

`extract_trees.py` records OSM `natural=tree` nodes and samples `natural=tree_row` ways. A row uses a mapped count if available; otherwise it uses the mapped spacing or an 8 m default. Sampling is deterministic and capped at 1,000 points per row. Estimated points within approximately 2 m of an already retained tree point are suppressed. Records carry longitude, latitude, height, crown diameter, needleleaf flag and whether the position was estimated; the manifest records counts and tile keys.

Below zoom 15, the overview GeoJSON is a clustered source, but only unclustered points are drawn. Mapped and estimated positions have different colors. At zoom 15 and above, `tree-layer.mjs` selects visible zoom-14 tiles, prioritizes tiles nearest the map center and limits concurrent fetches to eight. The cache evicts inactive tiles when it exceeds 48 entries; active tiles are retained. Valid tree heights range from 2-60 m and crown diameters from 1-40 m; otherwise height defaults to 8 m and crown diameter to the larger of 3 m or 55% of height. Three.js instanced meshes draw schematic trunks, broadleaf or needleleaf crowns, with deterministic color variation and additional nearby canopy detail.

== Street detail, selection and lighting

Street extraction records OSM `highway=street_lamp` and `amenity=bench` nodes as location and type. From zoom 17, the street layer loads visible zoom-14 tiles, permits up to eight pending requests, and evicts inactive cache entries above 48. It selects records in the view within approximately 1.2 km of the map center, sorts by distance and retains at most 1,000. Three.js instancing renders shared schematic lamp and bench geometries; dimensions and bench orientation are illustrative. Instances with unavailable terrain elevation are omitted while terrain is enabled.

For ordinary map clicks, `featureDetails` extracts a building's available render height, and a schematic Three.js selection marker is positioned at that height plus ground elevation. Network and NYC reservation hits are handled first. This is a selection marker; the current click path does not create a general OSM attribute-inspection panel.

Lighting is fixed to the southeast in the current controller. MapLibre uses a map-anchored light; custom Three.js scenes use a hemisphere light and a directional light with the matching preset. When enabled at zoom 15 or above and buildings are visible, `shadowFeatures` projects each eligible footprint away from the light, considering at most 1,500 input polygons and capping their render height at 150 m. The resulting ground polygons do not model time of day, terrain occlusion, building-to-building shadows, courtyards, tree shadows or tile completeness.

== Regional network adapters

The Toronto adapter loads TELUS and Bell GeoJSON, validates feature structure and counts, and derives map markers, direction arrows and fans. Indoor markers are retained; outdoor markers require a corresponding overview fan. Eligible outdoor purpose-built towers can have a schematic model based on consistent reported heights. The NYC adapter validates and loads its reservation points, filters proposed reservations from the map, and keeps them in the searchable list. It does not synthesize radio attributes.

= Failure handling and operational boundaries

- Region-catalog failure hides the loading overlay and exposes a reload action. Map-style failure exposes the map error UI. Terrain failure is reported separately; terrain can be disabled.
- Tree, roof and street-detail load failures display status and instruct the user to toggle the affected control to retry. Search failures are shown in the search panel; the browser times out the Photon request after 10 seconds.
- Network data is validated before use and can be retried by toggling the layer. Project data loading rejects invalid datasets or saved-list formats; the user can reselect a project to retry.
- A failed project write leaves the existing project list and boundary intact. If the selected project changes while a write is pending, a successful response still updates the saved project's in-memory cluster; a detached failed popup is reported in the project status.
- The SQLite database is local mutable state, not an asset cache that can be discarded without losing project edits. Multiple live servers pointed at different database paths can diverge. No synchronization, user access control, site-level audit history or recovery UI is implemented.

= Validation and source traceability

`make check` runs the JavaScript and Python tests and syntax checks. `make test-ui` runs the Playwright suite against a local server with a controlled map style and mocked external services; the live tests require `NDT_LIVE_UI=1`. The project tests cover default selection, full-radius geometry and hull containment, site edits, saved-list behavior, failure and retry, boundary fitting and region-specific limitations. SQLite tests cover initialization, migration and existing-destination preservation. Live tests are separate and require third-party services.

Implementation references: `ndt/server.py`, `ndt/regions.json`, the modules in `ndt/dist/`, the OSM extraction scripts in `ndt/scripts/`, `ndt/tests/`, `Makefile`, and `ndt/README.md`. Data source dates and counts are described in the companion feature description; source links appear in the viewer README.

= Feature implementation traceability

This register maps the 129 workbook feature IDs to their implementation references and current behavior at revision `836eec2`. Conditional entries are implemented only when the relevant data or conditions are met; Not available entries describe current gaps. See the feature description for each action and its detailed limitations. The workbook is a separate editable snapshot and changes are not automatically synchronized here.

#let feature_inventory = (
  ("NAV-01", "Toronto region", "Navigation", "Toronto", "Implemented", "Choose Toronto in the region picker.", "Loads the Toronto catalog and regional data.", "Region selection reloads the page.", "ndt/dist/app.js; ndt/regions.json",),
  ("NAV-02", "New York City region", "Navigation", "New York", "Implemented", "Choose New York City in the region picker.", "Loads the NYC catalog and Verizon reservation adapter.", "A reservation does not prove live service.", "ndt/dist/app.js; ndt/regions.json",),
  ("NAV-03", "Region URL selection", "Navigation", "Both", "Implemented", "Open a URL with a region parameter.", "The viewer resolves the requested region from the local catalog.", "Unknown region IDs fall back to the first catalog entry.", "ndt/dist/app.js",),
  ("NAV-04", "Region overview", "Navigation", "Both", "Implemented", "Choose Region overview.", "Flies the camera to the configured region center, zoom and pitch.", "View settings come from the catalog.", "ndt/dist/app.js; ndt/regions.json",),
  ("NAV-05", "Project shortcuts", "Navigation", "Both", "Implemented", "Select a project in the sidebar.", "Navigates to the project location or fits its valid boundary.", "New York projects have no calculated RF boundary.", "ndt/dist/app.js; ndt/regions.json",),
  ("NAV-06", "Map pan and zoom", "Navigation", "Both", "Implemented", "Drag, scroll, or use zoom controls.", "Changes the geographic view and loads visible data.", "External basemap tiles require a connection.", "ndt/dist/app.js; ndt/dist/index.html",),
  ("NAV-07", "Map pitch and rotation", "Navigation", "Both", "Implemented", "Use drag gestures or the tilt and rotation buttons.", "Changes camera pitch and bearing for 3D inspection.", "Maximum pitch is 75 degrees.", "ndt/dist/app.js",),
  ("NAV-08", "North and camera reset", "Navigation", "Both", "Implemented", "Choose north reset or camera reset.", "Resets bearing or returns to the region overview.", "Camera control availability reflects current limits.", "ndt/dist/app.js",),
  ("NAV-09", "Camera coordinates", "Navigation", "Both", "Implemented", "Move the map.", "Shows the current map center coordinates in the header.", "Displayed coordinates represent the camera center.", "ndt/dist/app.js; ndt/dist/index.html",),
  ("NAV-10", "Location search", "Navigation", "Both", "Implemented", "Enter a place name and submit.", "Sends a Photon query near the current map center and displays choices.", "Requires the external Photon service and network access.", "ndt/dist/app.js; ndt/dist/search.mjs",),
  ("NAV-11", "Search result navigation", "Navigation", "Both", "Implemented", "Choose a search result.", "Moves the camera to the selected coordinates.", "Only usable geocoded results are presented.", "ndt/dist/app.js; ndt/dist/search.mjs",),
  ("NAV-12", "Search failure and dismissal", "Navigation", "Both", "Implemented", "Search or press Escape.", "Reports unavailable or empty search results and closes the result panel on Escape.", "Photon requests use a 10-second timeout.", "ndt/dist/app.js",),
  ("NAV-13", "Mobile camera layout", "Navigation", "Both", "Implemented", "Use navigation on a phone-sized screen.", "Adapts camera and network panel placement for smaller viewports.", "Layout is responsive; it does not add touch-based project editing.", "ndt/dist/style.css; ndt/tests/ui/app.spec.cjs",),
  ("NAV-14", "Map feature selection marker", "Navigation", "Both", "Conditional", "Click a visible basemap feature.", "Places a schematic 3D marker at the clicked location and available building height.", "There is no general OSM attribute-inspection panel.", "ndt/dist/app.js; ndt/dist/map-data.mjs",),
  ("MAP-01", "OpenStreetMap-derived basemap", "3D city map", "Both", "Implemented", "Open the regional map.", "Loads the OpenFreeMap Liberty style and OpenMapTiles-based city data.", "Provider schema and zoom determine which OSM features and tags appear.", "ndt/dist/app.js; ndt/README.md",),
  ("MAP-02", "Roads and transportation", "3D city map", "Both", "Conditional", "View or toggle Streets.", "Displays provider transportation and transportation-name layers.", "Available roads and labels depend on the vector tiles.", "ndt/dist/map-data.mjs; ndt/dist/app.js",),
  ("MAP-03", "Land, water and labels", "3D city map", "Both", "Conditional", "Browse the map.", "Displays available land use, water, labels and points of interest.", "The water fill is a visual treatment, not a measured property.", "ndt/dist/app.js; ndt/README.md",),
  ("MAP-04", "Map attribution", "3D city map", "Both", "Implemented", "View the map attribution.", "Displays attribution for map and terrain providers.", "OSM data is subject to its applicable license.", "ndt/dist/app.js; ndt/README.md",),
  ("MAP-05", "Building layer toggle", "3D city map", "Both", "Implemented", "Toggle Buildings in Map Settings.", "Shows or hides building layers and mapped roof models.", "Missing provider tiles or source tags can limit geometry.", "ndt/dist/app.js; ndt/dist/map-data.mjs",),
  ("MAP-06", "Building extrusions", "3D city map", "Both", "Conditional", "Inspect building footprints at suitable zoom.", "Uses available tile render height, base and color for 3D extrusions.", "Tile attributes and provider styling determine the displayed geometry.", "ndt/dist/app.js; ndt/dist/roof-layer.mjs",),
  ("MAP-07", "Map style recovery", "3D city map", "Both", "Implemented", "Use Retry after a map-load failure.", "Displays an error if the map has not finished loading in time.", "Map tiles and style are external services.", "ndt/dist/app.js",),
  ("MAP-08", "Terrain elevation", "3D city map", "Both", "Conditional", "View terrain or toggle Terrain.", "Drapes the map on Mapterhorn Terrarium elevation tiles at 1x exaggeration.", "DEM samples are estimates; terrain service and tiles must be available.", "ndt/dist/app.js; ndt/README.md",),
  ("MAP-09", "Terrain unavailable status", "3D city map", "Both", "Implemented", "Disable Terrain if tiles are unavailable.", "Reports loading or missing elevation tiles and supports a flat view.", "Detailed items with unresolved elevation may be omitted.", "ndt/dist/app.js; ndt/dist/tree-layer.mjs",),
  ("MAP-10", "Shared map and 3D rendering", "3D city map", "Both", "Implemented", "Inspect custom 3D detail on the map.", "Three.js layers share the MapLibre canvas, WebGL context and projection.", "Models are schematic rather than photorealistic.", "ndt/dist/roof-layer.mjs; ndt/dist/tree-layer.mjs; ndt/dist/street-detail.mjs",),
  ("MAP-11", "Fixed scene lighting", "3D city map", "Both", "Implemented", "View the map and custom 3D layers.", "Uses a fixed southeast light preset with hemisphere and directional light.", "Lighting does not represent actual date, time or weather.", "ndt/dist/lighting.mjs; ndt/dist/app.js",),
  ("MAP-12", "Building shadows", "3D city map", "Both", "Conditional", "Enable Shadows with Buildings on at zoom 15 or above.", "Projects illustrative shadows away from the fixed light.", "Off by default; no terrain, courtyard, tree or building occlusion model.", "ndt/dist/shadows.mjs; ndt/dist/app.js",),
  ("MAP-13", "Shadow rendering budget", "3D city map", "Both", "Implemented", "View enabled shadows at close zoom.", "Processes up to 1,500 input polygons and caps render height at 150 m.", "Clipped tiles and missing building heights affect coverage.", "ndt/dist/shadows.mjs",),
  ("ROOF-01", "OSM roof extraction", "Buildings and roofs", "Both", "Implemented", "Prepare the regional roof dataset.", "Extracts supported building or building-part roof shapes and relevant OSM tags.", "Flat records require a roof color or material.", "ndt/scripts/extract_roofs.py",),
  ("ROOF-02", "Roof overlay activation", "Buildings and roofs", "Both", "Conditional", "Zoom to 15 or closer with Buildings enabled.", "Loads and renders matching prepared roof geometry.", "Matches depend on provider feature IDs and available data.", "ndt/dist/roof-layer.mjs",),
  ("ROOF-03", "Flat roof color overlay", "Buildings and roofs", "Both", "Conditional", "Inspect a matched flat roof.", "Overlays the available roof color or material while keeping the native building.", "Needs a valid native height and supported color or material.", "ndt/dist/roof-layer.mjs; ndt/scripts/extract_roofs.py",),
  ("ROOF-04", "Skillion and shed roofs", "Buildings and roofs", "Both", "Conditional", "Inspect a matched skillion roof.", "Builds a sloped plane; extraction maps shed to skillion.", "Requires valid footprint and height; unmatched features remain flat.", "ndt/dist/roof-geometry.mjs; ndt/scripts/extract_roofs.py",),
  ("ROOF-05", "Gabled and pitched roofs", "Buildings and roofs", "Both", "Conditional", "Inspect a matched gabled roof.", "Builds a gabled roof; extraction maps pitched to gabled.", "Unsupported footprint conditions fall back to the native extrusion.", "ndt/dist/roof-geometry.mjs; ndt/scripts/extract_roofs.py",),
  ("ROOF-06", "Hipped roofs", "Buildings and roofs", "Both", "Conditional", "Inspect a matched hipped roof.", "Builds a roof with ridge endpoints for a suitable footprint.", "Geometry is limited to suitable four-corner footprints.", "ndt/dist/roof-geometry.mjs",),
  ("ROOF-07", "Pyramidal and cone roofs", "Buildings and roofs", "Both", "Conditional", "Inspect matched pyramid or cone forms.", "Generates a bounded peak using the footprint and available height.", "Unsupported footprints or missing inputs remain flat.", "ndt/dist/roof-geometry.mjs",),
  ("ROOF-08", "Dome and onion roofs", "Buildings and roofs", "Both", "Conditional", "Inspect matched dome or onion forms.", "Builds illustrative curved or ring-based profiles.", "Appearance is not a surveyed architectural model.", "ndt/dist/roof-geometry.mjs",),
  ("ROOF-09", "Concave footprints and holes", "Buildings and roofs", "Both", "Conditional", "Inspect supported mapped footprints.", "Handles concave gabled and skillion forms and holes in flat or skillion shapes.", "Other concavity or holes can cause a flat fallback.", "ndt/dist/roof-geometry.mjs; ndt/dist/roof-layer.mjs",),
  ("ROOF-10", "Roof direction and height", "Buildings and roofs", "Both", "Conditional", "Inspect a matched pitched roof.", "Uses available direction, orientation, height, levels or angle tags.", "When inputs are absent, the footprint frame and height can be estimated.", "ndt/dist/roof-geometry.mjs",),
  ("ROOF-11", "Roof and wall materials", "Buildings and roofs", "Both", "Conditional", "Inspect a rendered mapped roof.", "Uses recognized color tags or a material palette with fallback colors.", "Unsupported colors or absent tags use defaults.", "ndt/dist/roof-layer.mjs",),
  ("ROOF-12", "Roof feature ID matching", "Buildings and roofs", "Both", "Conditional", "Load a visible roof overlay.", "Matches OSM way or relation IDs to provider tile feature IDs.", "Mappings were checked for a Toronto tile; NYC matching is not independently verified.", "ndt/dist/roof-layer.mjs; ndt/README.md",),
  ("ROOF-13", "Safe roof fallback and retry", "Buildings and roofs", "Both", "Implemented", "Toggle Buildings after an unavailable roof load.", "Keeps the native building until replacement geometry is ready.", "Failed, ambiguous or unsupported roof geometry may remain flat.", "ndt/dist/roof-layer.mjs",),
  ("TREE-01", "Mapped OSM trees", "Trees", "Both", "Conditional", "Enable Trees and inspect the map.", "Uses OSM natural=tree nodes from the prepared regional extract.", "Extracts are dated and are not a complete tree inventory.", "ndt/scripts/extract_trees.py; ndt/README.md",),
  ("TREE-02", "Tree-row estimates", "Trees", "Both", "Conditional", "View tree-row points and models.", "Samples mapped tree_row ways using reported count or spacing.", "Positions are estimates; default spacing is 8 m when absent.", "ndt/scripts/extract_trees.py; ndt/scripts/tree_sampling.py",),
  ("TREE-03", "Tree-row deduplication", "Trees", "Both", "Implemented", "Prepare the regional tree dataset.", "Suppresses estimated points within approximately 2 m of a retained tree point.", "Sampling is capped at 1,000 points per row.", "ndt/scripts/extract_trees.py; ndt/scripts/tree_sampling.py",),
  ("TREE-04", "Tree overview points", "Trees", "Both", "Conditional", "View Trees below zoom 15.", "Draws unclustered overview points with different colors for estimates.", "Clustered points are not drawn by the overview layer.", "ndt/dist/app.js",),
  ("TREE-05", "3D tree models", "Trees", "Both", "Conditional", "Zoom to 15 or closer with Trees enabled.", "Renders terrain-aligned schematic trunks and crowns using instancing.", "Tree locations and shapes are not independently surveyed.", "ndt/dist/tree-layer.mjs",),
  ("TREE-06", "Broadleaf and needleleaf crowns", "Trees", "Both", "Conditional", "Inspect 3D trees.", "Selects broad or needle-like geometry from the leaf-type flag.", "Unknown or absent leaf type falls back to the broad category.", "ndt/scripts/extract_trees.py; ndt/dist/tree-layer.mjs",),
  ("TREE-07", "Tree size fallbacks", "Trees", "Both", "Implemented", "View trees with missing or invalid dimensions.", "Uses 8 m height and a crown derived from height when measurements are unusable.", "Accepted height is 2-60 m and crown diameter is 1-40 m.", "ndt/dist/tree-data.mjs",),
  ("TREE-08", "Tree tile loading and retry", "Trees", "Both", "Implemented", "Move around the map or toggle Trees after a failure.", "Loads visible zoom-14 tiles and limits concurrent requests to eight.", "Cache evicts inactive entries above 48; active entries may remain.", "ndt/dist/tree-layer.mjs",),
  ("STREET-01", "Mapped street lamps", "Street detail", "Both", "Conditional", "Enable Street details and zoom to 17 or closer.", "Renders simple models at mapped highway=street_lamp nodes.", "Objects are illustrative and may have changed since the extract.", "ndt/scripts/extract_street_detail.py; ndt/dist/street-detail.mjs",),
  ("STREET-02", "Mapped benches", "Street detail", "Both", "Conditional", "Enable Street details and zoom to 17 or closer.", "Renders simple models at mapped amenity=bench nodes.", "Dimensions and orientation are illustrative.", "ndt/scripts/extract_street_detail.py; ndt/dist/street-detail.mjs",),
  ("STREET-03", "Street detail display budget", "Street detail", "Both", "Implemented", "Inspect street details.", "Selects visible features within about 1.2 km and shows up to 1,000 nearest.", "Features outside the view, radius or budget are not drawn.", "ndt/dist/street-detail.mjs",),
  ("STREET-04", "Street detail tile recovery", "Street detail", "Both", "Implemented", "Toggle Street details after a load failure.", "Retries regional manifest and tile data.", "Terrain elevation may be unavailable while tiles load.", "ndt/dist/street-detail.mjs; ndt/dist/app.js",),
  ("NET-01", "TELUS site layer", "Toronto network", "Toronto", "Implemented", "Toggle TELUS sites.", "Shows ISED-reported TELUS site locations.", "The supplied selection is classified as indoor.", "ndt/dist/app.js; ndt/dist/network-layer.mjs",),
  ("NET-02", "Bell outdoor site layer", "Toronto network", "Toronto", "Implemented", "Toggle Bell outdoor.", "Shows eligible Bell outdoor location markers and network context.", "A Bell license alone does not establish TELUS use at that site.", "ndt/dist/app.js; ndt/README.md",),
  ("NET-03", "Indoor marker preservation", "Toronto network", "Toronto", "Implemented", "View enabled Toronto sites.", "Retains indoor site markers even when no fan exists.", "Current TELUS records do not prove indoor coverage.", "ndt/dist/network-symbols.mjs",),
  ("NET-04", "Outdoor marker fan requirement", "Toronto network", "Toronto", "Conditional", "View enabled outdoor sites.", "Draws outdoor markers that have usable overview fans.", "Other licensed records remain searchable in the network panel.", "ndt/dist/network-symbols.mjs; ndt/dist/app.js",),
  ("NET-05", "Provider and site colors", "Toronto network", "Toronto", "Implemented", "Inspect map markers and legend.", "Distinguishes indoor, outdoor, Bell and other site classes by color.", "Colors are presentation categories, not service confirmation.", "ndt/dist/app.js; ndt/dist/style.css",),
  ("NET-06", "Licensed site search", "Toronto network", "Toronto", "Implemented", "Search by location, IDs, coordinates or licensee.", "Filters enabled site records and presents up to eight nearest matches.", "Search results are limited to the loaded regional dataset.", "ndt/dist/network-symbols.mjs; ndt/dist/app.js",),
  ("NET-07", "Site selection and details", "Toronto network", "Toronto", "Implemented", "Select a map marker or list entry.", "Shows location, licensee, technology, record count and available site attributes.", "Reported fields may be incomplete or not independently verified.", "ndt/dist/app.js",),
  ("NET-08", "View site in 3D", "Toronto network", "Toronto", "Implemented", "Choose View site in 3D in the site details.", "Moves and tilts the camera toward the selected site.", "A location marker or tower model is not proof of an active site.", "ndt/dist/app.js",),
  ("NET-09", "TELUS cell and antenna records", "Toronto network", "Toronto", "Implemented", "Expand the selected TELUS site records.", "Shows available reported directional and non-directional antenna attributes.", "The selection is an ISED record grouping, not a verified physical inventory.", "ndt/dist/app.js",),
  ("NET-10", "Bell directional bearing records", "Toronto network", "Toronto", "Implemented", "Expand reported directional bearings.", "Groups records by valid azimuth and lists available frequencies and widths.", "A bearing group does not establish one unique physical sector.", "ndt/dist/network-symbols.mjs; ndt/dist/app.js",),
  ("NET-11", "Non-directional rings", "Toronto network", "Toronto", "Conditional", "Inspect a TELUS location.", "Shows a ring when all records at that site are non-directional.", "Mixed or unknown antenna patterns are not treated as all omni.", "ndt/dist/network-symbols.mjs; ndt/dist/app.js",),
  ("NET-12", "Directional arrows", "Toronto network", "Toronto", "Conditional", "Zoom to 14 or closer.", "Displays arrows for distinct valid reported transmit bearings.", "Arrows depend on the available ISED azimuth data.", "ndt/dist/network-symbols.mjs; ndt/dist/app.js",),
  ("NET-13", "Schematic tower models", "Toronto network", "Toronto", "Conditional", "Zoom to 14 or closer at a qualifying outdoor tower.", "Draws a lattice model using a consistent valid reported structure height.", "Only outdoor purpose-built towers with matching 1-600 m heights qualify.", "ndt/dist/network-layer.mjs; ndt/README.md",),
  ("NET-14", "Sector fan visibility", "Toronto network", "Toronto", "Implemented", "Toggle Sector fans.", "Shows or hides the planning fan layers.", "Fans are illustrative estimates, not measured coverage.", "ndt/dist/app.js",),
  ("NET-15", "Three-bearing overview fans", "Toronto network", "Toronto", "Conditional", "View Bell outdoor with valid assumptions.", "Draws overview wedges for sites with exactly three usable directional bearings.", "Requires usable widths, frequencies and a positive modeled radius.", "ndt/dist/network-symbols.mjs",),
  ("NET-16", "Selected-site fan detail", "Toronto network", "Toronto", "Conditional", "Select a Bell site.", "Highlights usable bearing fans even when the bearing count differs from three.", "Bearing colors repeat after three and are not cell identifiers.", "ndt/dist/app.js; ndt/dist/network-symbols.mjs",),
  ("NET-17", "Bearing selection", "Toronto network", "Toronto", "Conditional", "Click a fan or use the bearing buttons.", "Highlights a selected bearing and shows the estimate details.", "Overlapping fans may be easier to select with bearing buttons.", "ndt/dist/app.js",),
  ("NET-18", "Selected-site-only focus", "Toronto network", "Toronto", "Implemented", "Enable Show fans for selected site only.", "Reduces fan overlap by focusing on the selected Bell site.", "A Bell site must be selected to display focused fans.", "ndt/dist/app.js",),
  ("NET-19", "Fan intensity", "Toronto network", "Toronto", "Implemented", "Adjust Fan intensity.", "Changes fan opacity without changing the underlying estimate.", "The control is a display setting, not an RF parameter.", "ndt/dist/app.js",),
  ("NET-20", "Network data validation and retry", "Toronto network", "Toronto", "Implemented", "Toggle a network layer after a failed load.", "Validates loaded feature structures, record totals and unique site IDs.", "A missing or invalid dataset is reported rather than displayed.", "ndt/dist/app.js; ndt/dist/network-layer.mjs",),
  ("RF-01", "UMa path-loss model", "Radio planning", "Toronto", "Implemented", "Choose LOS or NLOS and planning assumptions.", "Calculates 3GPP TR 38.901 UMa mean path loss and a link-budget radius.", "This is not calibrated coverage, RSRP or SINR.", "ndt/dist/radio-model.mjs",),
  ("RF-02", "Default planning assumptions", "Radio planning", "Toronto", "Implemented", "Open the network planning controls.", "Defaults to NLOS, 46 dBm EIRP and -100 dBm threshold.", "These are assumptions, not published site parameters.", "ndt/dist/radio-model.mjs; ndt/dist/app.js",),
  ("RF-03", "Scenario validation", "Radio planning", "Toronto", "Implemented", "Edit EIRP, threshold or environment.", "Accepts EIRP 0-90 dBm and threshold -160 to -20 dBm.", "Invalid values make calculated boundaries and fans unavailable.", "ndt/dist/radio-model.mjs; ndt/dist/app.js",),
  ("RF-04", "Model height assumptions", "Radio planning", "Toronto", "Implemented", "Calculate a planning radius.", "Uses a fixed 25 m base station and 1.5 m terminal height.", "Reported tower heights are not substituted into this model.", "ndt/dist/radio-model.mjs",),
  ("RF-05", "Frequency and beamwidth selection", "Radio planning", "Toronto", "Conditional", "Generate a bearing fan.", "Uses the lowest valid frequency and widest valid reported width for each bearing.", "A frequency must be in the 0.5-100 GHz model range.", "ndt/dist/network-symbols.mjs; ndt/dist/radio-model.mjs",),
  ("RF-06", "Radius range and search", "Radio planning", "Toronto", "Implemented", "Calculate a planning radius.", "Searches between 10 m and 5 km with 48 binary-search iterations.", "Results can be below the model range or capped at 5 km.", "ndt/dist/radio-model.mjs",),
  ("RF-07", "Scaled overview fan geometry", "Radio planning", "Toronto", "Implemented", "View overview fans.", "Draws fans at 5/12 of calculated radius with at least 15-degree display width.", "Displayed extent is intentionally different from full model radius.", "ndt/dist/network-symbols.mjs",),
  ("RF-08", "Full-radius project geometry", "Radio planning", "Toronto", "Conditional", "Generate a project boundary.", "Uses calculated full radius and reported width for each wedge.", "The model omits obstruction, interference, fading, loading and penetration losses.", "ndt/dist/network-symbols.mjs; ndt/dist/project-coverage.mjs",),
  ("RF-09", "Detailed propagation simulation", "Radio planning", "Both", "Not available", "No simulation action is available.", "The current code provides a planning visualization.", "No calibrated ray tracing, measured coverage or NDT execution pipeline.", "ndt/dist/radio-model.mjs; docs/SOFTWARE_DESIGN.typ",),
  ("PROJ-01", "Four Toronto project boundaries", "Project areas", "Toronto", "Implemented", "Open the Toronto overview.", "Displays boundaries for Harbourfront, Etobicoke, North York and Scarborough.", "A boundary is omitted when needed estimates are unavailable.", "ndt/regions.json; ndt/dist/app.js",),
  ("PROJ-02", "Automatic seven-site cluster", "Project areas", "Toronto", "Conditional", "Load a project without a saved override.", "Chooses the eligible site nearest the project center and its six nearest eligible sites.", "No fixed maximum distance or globally optimal cluster is enforced.", "ndt/dist/project-coverage.mjs",),
  ("PROJ-03", "Cluster distance and tie break", "Project areas", "Toronto", "Implemented", "Select an automatically generated cluster.", "Uses haversine distances and site ID to break equal-distance ties.", "Displayed radius is measured from the first site in the list.", "ndt/dist/project-coverage.mjs; ndt/dist/app.js",),
  ("PROJ-04", "Project site eligibility", "Project areas", "Toronto", "Conditional", "Select or add a Bell location.", "Requires exactly three usable default-scenario sector fans for automatic selection or UI addition.", "Backend membership validation confirms known IDs, not radio eligibility.", "ndt/dist/project-coverage.mjs; ndt/dist/app.js; ndt/server.py",),
  ("PROJ-05", "Single enclosing project area", "Project areas", "Toronto", "Conditional", "View a project with usable site estimates.", "Computes one convex-hull polygon from the full-radius sector vertices.", "The hull can include gaps and is not a point-by-point coverage map.", "ndt/dist/project-coverage.mjs",),
  ("PROJ-06", "Dashed boundary appearance", "Project areas", "Toronto", "Implemented", "View project boundaries.", "Draws a 4 px dark-green dashed line with a 6 px white halo.", "Line width is a display treatment.", "ndt/dist/app.js",),
  ("PROJ-07", "Fit selected project boundary", "Project areas", "Toronto", "Conditional", "Choose a Toronto project.", "Fits the full valid boundary in a top-down view with control padding.", "An invalid or absent boundary cannot be fitted.", "ndt/dist/app.js",),
  ("PROJ-08", "Phone project view", "Project areas", "Toronto", "Implemented", "Choose a project on a phone.", "Closes the network panel to provide map space; Network can reopen it.", "The project editing action currently uses right-click.", "ndt/dist/app.js; ndt/dist/style.css",),
  ("PROJ-09", "Selected project site list", "Project areas", "Toronto", "Implemented", "Select a project.", "Lists its current sites, site count and maximum distance from the first site.", "The radius is a cluster indicator rather than an RF coverage radius.", "ndt/dist/app.js",),
  ("PROJ-10", "Right-click add site", "Project areas", "Toronto", "Conditional", "Right-click an eligible Bell marker and choose Add site.", "Saves the current project membership including the added site.", "A site needs three usable default-scenario sector estimates in the UI.", "ndt/dist/app.js",),
  ("PROJ-11", "Right-click remove site", "Project areas", "Toronto", "Conditional", "Right-click a selected project site and choose Remove site.", "Saves the current project membership without that site.", "A project may temporarily have fewer than seven sites.", "ndt/dist/app.js",),
  ("PROJ-12", "Save-first boundary refresh", "Project areas", "Toronto", "Implemented", "Add or remove a project site.", "After the SQLite update succeeds, refreshes the list, boundary and fitted view.", "A failed save leaves the previous state intact and offers retry.", "ndt/dist/app.js; ndt/server.py",),
  ("PROJ-13", "Project membership persistence", "Project areas", "Toronto", "Implemented", "Reload or restart after a successful project edit.", "Restores saved site IDs from the project_sites SQLite table.", "Back up the database to preserve user edits.", "ndt/server.py; ndt/dist/app.js",),
  ("PROJ-14", "Seven-site target warning", "Project areas", "Toronto", "Implemented", "Edit a project to a count other than seven.", "The project panel warns that seven sites are required for simulation.", "The server does not enforce a seven-site count.", "ndt/dist/app.js",),
  ("PROJ-15", "Empty project", "Project areas", "Toronto", "Implemented", "Remove all sites from a project.", "Shows an empty-project message and allows eligible Bell sites to be added.", "No boundary can be drawn for an empty set.", "ndt/dist/app.js; ndt/dist/project-coverage.mjs",),
  ("PROJ-16", "Missing saved site handling", "Project areas", "Toronto", "Implemented", "Load a project whose saved ID is missing from the current data.", "Disables the affected boundary and editing instead of silently dropping IDs.", "A changed source dataset can make an old saved project unavailable.", "ndt/dist/app.js",),
  ("PROJ-17", "Scenario-driven project updates", "Project areas", "Toronto", "Implemented", "Change EIRP, threshold or LOS/NLOS mode.", "Recalculates boundaries for the same site memberships.", "A site without three usable fans under the scenario invalidates its boundary.", "ndt/dist/app.js; ndt/dist/project-coverage.mjs",),
  ("PROJ-18", "New York radio project boundary", "Project areas", "New York", "Not available", "Select a New York project shortcut.", "Navigates to the configured location and explains why coverage is unavailable.", "Reservation records lack bearing, beamwidth and frequency.", "ndt/dist/app.js; ndt/regions.json",),
  ("NYC-01", "Verizon-related reservation dataset", "New York reservations", "New York", "Implemented", "Open the New York region.", "Loads NYC pole reservations filtered to franchisee NY SMSA.", "Reservations are not a complete Verizon site inventory.", "ndt/dist/nyc-reservations.mjs; ndt/scripts/extract_nyc_verizon.py",),
  ("NYC-02", "Installed reservation markers", "New York reservations", "New York", "Implemented", "View the reservation layer.", "Displays installed reservations as markers.", "Installed status does not prove active radio service.", "ndt/dist/nyc-reservations.mjs",),
  ("NYC-03", "Approved reservation markers", "New York reservations", "New York", "Implemented", "View the reservation layer.", "Displays approved reservations as markers.", "Approved status does not imply installed equipment.", "ndt/dist/nyc-reservations.mjs",),
  ("NYC-04", "Proposed reservation search", "New York reservations", "New York", "Implemented", "Search the reservation list.", "Keeps proposed records searchable but filters them from map markers.", "Proposed reservations are administrative records.", "ndt/dist/nyc-reservations.mjs",),
  ("NYC-05", "Reservation details", "New York reservations", "New York", "Implemented", "Select a reservation marker or list result.", "Shows available ID, status, street, borough, pole type and dates.", "Fields depend on the source record.", "ndt/dist/nyc-reservations.mjs",),
  ("NYC-06", "Reservation search and nearby list", "New York reservations", "New York", "Implemented", "Search or move the map.", "Lists up to eight nearest matching or nearby reservations.", "Searches the supplied filtered snapshot.", "ndt/dist/nyc-reservations.mjs",),
  ("NYC-07", "Reservation layer recovery", "New York reservations", "New York", "Implemented", "Toggle the Verizon reservation layer after failure.", "Retries unavailable or invalid reservation data.", "Requires the local SQLite API and regional asset.", "ndt/dist/nyc-reservations.mjs",),
  ("NYC-08", "New York radio fans", "New York reservations", "New York", "Not available", "No New York radio-fan control is offered.", "The current adapter does not synthesize radio sector inputs.", "Source records do not provide bearings, beamwidth or frequency.", "ndt/dist/nyc-reservations.mjs; ndt/README.md",),
  ("DATA-01", "Region catalog", "Data and service", "Both", "Implemented", "Start the viewer.", "Loads configured region metadata, map defaults, project shortcuts and assets.", "Adding a region also requires compatible regional datasets and an adapter.", "ndt/regions.json; ndt/server.py",),
  ("DATA-02", "SQLite-backed asset service", "Data and service", "Both", "Implemented", "Start the local Python server.", "Stores region metadata and prepared assets in SQLite and serves them to the browser.", "A static-only server cannot provide the required API.", "ndt/server.py",),
  ("DATA-03", "Project-root SQLite file", "Data and service", "Both", "Implemented", "Run make run.", "Uses regions.sqlite3 in the project root by default.", "The database contains user project edits and should be backed up.", "ndt/server.py; ndt/README.md",),
  ("DATA-04", "Legacy SQLite migration", "Data and service", "Both", "Conditional", "Start the updated server without a root database.", "Copies an existing ndt/var database using the SQLite backup API.", "Stop older servers first; the old file is retained and an existing destination is not overwritten.", "ndt/server.py; ndt/tests/test-regions.py",),
  ("DATA-05", "Custom database path", "Data and service", "Both", "Implemented", "Start server.py with --db.", "Uses the specified SQLite file.", "An explicit database path bypasses default-path migration.", "ndt/server.py",),
  ("DATA-06", "SQLite project-site storage", "Data and service", "Toronto", "Implemented", "Save project membership.", "Stores each project ID and its ordered site-ID array.", "Whole-list updates have no concurrent-edit merge or audit history.", "ndt/server.py",),
  ("DATA-07", "Asset refresh at startup", "Data and service", "Both", "Implemented", "Restart after regional inputs change.", "Updates region metadata and replaces asset blobs when the fingerprint changes.", "The fingerprint uses paths, file sizes and modification times, not content hashes.", "ndt/server.py",),
  ("DATA-08", "Region catalog endpoint", "Data and service", "Both", "Implemented", "Browser requests GET /api/regions.", "Returns a JSON array of configured region metadata.", "The catalog is served by the local Python service.", "ndt/server.py",),
  ("DATA-09", "Regional asset endpoint", "Data and service", "Both", "Implemented", "Browser requests an asset for a region.", "Returns the matching stored blob with an inferred content type.", "Unknown asset or region paths return 404.", "ndt/server.py",),
  ("DATA-10", "Project membership endpoint", "Data and service", "Toronto", "Implemented", "Browser reads or saves project memberships.", "GET returns saved project lists and PUT replaces a selected project list.", "PUT accepts at most 1,000 unique known IDs and a 100,000-byte body.", "ndt/server.py",),
  ("DATA-11", "Local server port fallback", "Data and service", "Both", "Implemented", "Run make run.", "Uses the first available port in the 5179-5189 range.", "Only address-in-use triggers fallback; an explicit PORT is exact.", "ndt/server.py; Makefile",),
  ("DATA-12", "Local host binding", "Data and service", "Both", "Implemented", "Start the local service.", "Defaults to 127.0.0.1 and allows an explicit host override.", "There is no built-in authentication or authorization.", "ndt/server.py",),
  ("DATA-13", "OpenStreetMap data preparation", "Data and service", "Both", "Implemented", "Rebuild regional roof, tree or street-detail assets.", "Extracts supported OSM features from a supplied PBF.", "Prepared extracts are dated and can differ from current live tiles.", "ndt/scripts/extract_roofs.py; ndt/scripts/extract_trees.py; ndt/scripts/extract_street_detail.py",),
  ("DATA-14", "ISED data preparation", "Data and service", "Toronto", "Implemented", "Rebuild TELUS and Bell assets from an ISED ZIP.", "Filters and groups records by provider and coordinates.", "Counts describe licensed records and coordinate pairs, not surveyed physical sites.", "ndt/scripts/extract_telus_sites.py; ndt/scripts/extract_bell_outdoor.py",),
  ("DATA-15", "NYC reservation preparation", "Data and service", "New York", "Implemented", "Rebuild the NYC reservation GeoJSON.", "Filters the downloaded NYC dataset to valid NY SMSA reservations.", "The filtered data does not establish complete Verizon coverage.", "ndt/scripts/extract_nyc_verizon.py",),
  ("DATA-16", "Project data retry", "Data and service", "Toronto", "Implemented", "Reselect a project after a load failure.", "Retries project data loading when the cached fetch fails.", "Invalid saved lists or missing site IDs are reported.", "ndt/dist/app.js",),
  ("DATA-17", "Concurrent project edit protection", "Data and service", "Toronto", "Not available", "Edit the same project in separate sessions.", "Each successful PUT writes the entire membership list.", "There is no revision token or merge; a later successful write can overwrite an earlier one.", "ndt/server.py; docs/SOFTWARE_DESIGN.typ",),
  ("DATA-18", "Access control", "Data and service", "Both", "Not available", "Expose the server beyond localhost.", "No login or per-user access control is implemented.", "Limit access externally if a non-loopback host is configured.", "ndt/server.py; docs/SOFTWARE_DESIGN.typ",),
  ("QA-01", "Core validation suite", "Quality and operations", "Both", "Implemented", "Run make check.", "Runs JavaScript and Python tests and source syntax checks.", "A passing local test does not establish live provider availability.", "Makefile; ndt/tests/",),
  ("QA-02", "Controlled browser suite", "Quality and operations", "Both", "Implemented", "Run make test-ui.", "Tests controls, site editing, layout, failure paths and accessibility checks.", "The standard suite substitutes a controlled map style and search responses.", "playwright.config.cjs; ndt/tests/ui/",),
  ("QA-03", "Live map smoke tests", "Quality and operations", "Both", "Implemented", "Run UI tests with NDT_LIVE_UI=1.", "Exercises live map services and captures browser screenshots.", "Live tests depend on external providers and network connectivity.", "ndt/tests/ui/live.spec.cjs; ndt/README.md",),
  ("QA-04", "Keyboard and accessibility checks", "Quality and operations", "Both", "Implemented", "Use keyboard controls and run browser accessibility tests.", "Supports keyboard operation for controls and checks WCAG A/AA rules.", "Automated checks do not replace assistive-technology testing.", "ndt/tests/ui/app.spec.cjs; ndt/README.md",),
)
#let feature_categories = ("Navigation", "3D city map", "Buildings and roofs", "Trees", "Street detail", "Toronto network", "Radio planning", "Project areas", "New York reservations", "Data and service", "Quality and operations",)
#set text(size: 8.7pt)
#for category in feature_categories {
  heading(level: 2, category)
  let entries = feature_inventory.filter(row => row.at(2) == category)
  table(
    columns: (23mm, 1.8fr, 3.9fr),
    table.header([*ID*], [*Feature / scope*], [*Implementation behavior and source*]),
    ..entries.map(row => (
      text(weight: "bold", row.at(0)),
      [*#(row.at(1))* #linebreak() #text(size: 8pt, fill: rgb("517465"))[#(row.at(3)) · #(row.at(4))]],
      [#(row.at(6)) #linebreak() #text(size: 8pt, fill: rgb("49675a"))[#(row.at(8))]],
    )).flatten(),
  )
}
