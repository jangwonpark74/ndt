#set document(title: "Regional NDT Viewer - Feature Description", author: "Toronto NDT project")
#set page(paper: "a4", margin: (x: 21mm, top: 22mm, bottom: 19mm),
  header: context text(size: 8pt, fill: rgb("647c72"))[TORONTO NDT  /  FEATURE DESCRIPTION],
  footer: context align(right, text(size: 8pt, fill: rgb("647c72"))[#counter(page).display()]))
#set text(font: ("Arial", "New Computer Modern"), size: 10pt, fill: rgb("1c3030"))
#set par(leading: 0.65em, spacing: 0.8em)
#show heading.where(level: 1): set text(size: 16pt, weight: "bold", fill: rgb("174c3b"))
#show heading.where(level: 2): set text(size: 11.5pt, weight: "bold", fill: rgb("285e4c"))
#set heading(numbering: "1.1")
#set table(stroke: 0.5pt + rgb("cbd9d1"), inset: 6pt)

#text(size: 9pt, weight: "bold", fill: rgb("54806b"))[IMPLEMENTED PRODUCT  /  07 NOVEMBER 2026]
#v(7mm)
#text(size: 27pt, weight: "bold", fill: rgb("173c30"))[Regional NDT Viewer]
#v(2mm)
#text(size: 18pt, fill: rgb("517465"))[Feature description]
#v(5mm)
#line(length: 100%, stroke: 1.3pt + rgb("6f9a7d"))

*Scope.* Implementation based on Git revision `836eec2`, including the subsequent individual-site SQLite storage update. The viewer combines a 3D city map, licensed-site context and illustrative radio planning geometry for Toronto, plus Verizon-related pole reservation context for New York City. This is an as-built description; it is not a specification of future functionality.

#table(columns: (1fr, 2.5fr),
  [*Document audience*], [Users, product owners, and reviewers of the local viewer],
  [*Primary interfaces*], [Browser map, navigation sidebar, network panels and local SQLite-backed service],
  [*Source of truth*], [`ndt/dist/`, `ndt/server.py`, `ndt/regions.json`, and `ndt/README.md`],
  [*Model boundary*], [Planning estimates and map visuals; no calibrated propagation or NDT simulation engine is implemented],
)

= Product overview

The application lets a user browse regional map data, explore network records and inspect project areas. It opens with a region overview, navigation controls, map layer settings and region-specific network context. Toronto and New York are selected from the left sidebar. A region change reloads the page with the chosen region in its URL.

The project is local-first for its catalog and prepared datasets. The browser still needs internet access for the map style and tiles, terrain tiles and location search. The local Python service and SQLite database are required; serving the static files alone does not provide the region API.

The database maintains Toronto network locations and New York reservations as individual records with their original details and coordinates. Map network data is assembled from these records. Existing databases are upgraded at startup without deleting project memberships. Refreshing changed regional input files replaces that region's imported network records; the viewer does not provide an interface for editing their details.

== Region coverage

#table(columns: (0.85fr, 1.8fr, 1.9fr),
  table.header([*Region*], [*Project shortcuts*], [*Network context*]),
  [Toronto], [Harbourfront, Etobicoke, North York, Scarborough], [TELUS licensed locations and Bell outdoor licensed locations from the ISED snapshot.],
  [New York City], [Manhattan, Brooklyn, Queens, The Bronx, Staten Island], [NY SMSA pole reservations associated with Verizon; not a complete site inventory.],
)

== Navigation and map

- Pan, rotate, tilt and zoom the map. The camera controls include a north reset and a return to the region overview. Search uses Photon and lets the user choose a returned location.
- Toggle buildings, streets, trees, terrain, street details and optional illustrative shadows. Detailed 3D roofs and trees appear at closer zoom levels; street lamps and benches appear at zoom 17 and above.
- View building, terrain and vegetation context over an OpenStreetMap-derived basemap. Roof shape and tree details depend on the available source tags and data coverage.
- The viewer presents error or retry guidance when the region service, map, terrain, or optional data layers cannot be loaded. Network and 3D layer retries use the corresponding on/off controls.

= OpenStreetMap-based 3D city visualization

== Basemap, terrain and interaction

The city scene combines an OpenFreeMap style and OpenMapTiles vector tiles derived from OpenStreetMap with a separate Mapterhorn elevation surface. The basemap can show roads, transportation, land use, water, labels, points of interest and building footprints, subject to the provider's tile schema and zoom-dependent styling. The viewer recolors water as a visual treatment. OpenStreetMap attribution is displayed in the map; the tile service does not expose every original OSM tag or feature.

Terrain is enabled at 1x exaggeration by default. The user can turn it off for a flat map, and the application reports missing or delayed elevation tiles. Ground elevations are sampled estimates rather than surveyed building bases. Pan, zoom, tilt, rotation and the navigation controls let the user inspect city context. Clicking a rendered map feature places a schematic selection marker; for a building the marker uses its available rendered height.

== Buildings and mapped roof forms

Where the basemap provides building geometry and height attributes, MapLibre displays extruded buildings. At zoom 15 and closer, the viewer can add roof geometry from the region's prepared OSM extract when it can match the building to the tile feature. It supports flat, skillion/shed, gabled/pitched, hipped, pyramidal, dome, cone and onion roof forms. Reported roof and building colors or materials are used where available; otherwise the viewer applies fallback colors. Roof direction, orientation, height and related tags inform the geometry when supplied.

Concave gabled and skillion footprints are supported. Flat and skillion shapes can preserve mapped courtyards in multipolygon relations. Some roof shapes and footprints are unsupported or cannot be matched safely; the original flat tile extrusion remains visible in those cases. Missing dimensions can be estimated. These shapes and colors should therefore be read as OSM-derived visualization, not a surveyed architectural model. Roof matching depends on the tile provider's feature IDs and is not independently verified for the New York extract.

== Trees and street furniture

The tree layer combines mapped `natural=tree` nodes with estimated points along mapped `natural=tree_row` ways. At overview zooms, unclustered tree points distinguish mapped and estimated records with different greens. From zoom 15, terrain-aligned 3D trees use schematic trunks and broadleaf or needleleaf crowns. Missing or unusable tree dimensions receive fallback sizes. Row points are estimates; they are not a tree census or guaranteed current positions.

At zoom 17 and closer, mapped `highway=street_lamp` and `amenity=bench` nodes appear as simple 3D models. The viewer displays at most 1,000 nearby lamps and benches within 1.2 km of the map center. Object dimensions and bench orientation are illustrative. A mapped node does not guarantee that the object is still present.

== Lighting, shadows and layer controls

The map and 3D scene use fixed southeast lighting. Optional building shadows are off by default and are shown only when buildings are enabled and the view is close enough. Shadows are projected from available building footprints onto the ground; they are illustrative, not a time-of-day sun or physical shadow simulation. They do not account for terrain or building occlusion, courtyards, tree shadows, clipping or incomplete data.

Map Settings lets the user independently toggle buildings, streets, trees, terrain, street details and shadows. A layer can be absent because its data, tile, elevation, OSM tags or supported geometry are unavailable; the viewer is not a complete city inventory.

== Prepared extract coverage

The following figures describe files currently supplied with the repository, not features guaranteed to appear in a particular view. Toronto and New York use separate BBBike OSM PBF extracts dated 2026-10-31. The New York extract extends beyond the five boroughs and is not clipped to the municipal boundary.

#table(columns: (1fr, 1.05fr, 1.05fr, 1.05fr, 1.05fr),
  table.header([*Region*], [*Roof records*], [*Mapped trees*], [*Estimated row trees*], [*Lamps / benches*]),
  [Toronto], [18,779], [54,879], [5,113], [29,015 / 10,759],
  [New York extract], [14,768], [72,374], [6,074], [17,287 / 21,834],
)

The roof count is the number of extracted roof records, not a count of all buildings or of models successfully matched to tiles. OSM source coverage varies by location, and the prepared extracts can differ in date and coverage from the live basemap.

= Toronto network exploration

== Site layers and inspection

The Toronto network panel displays TELUS and Bell outdoor records as separate, independently controlled layers. TELUS indoor locations remain visible. Outdoor markers appear when a usable overview fan exists; other licensed records remain searchable. The current TELUS extract is classified as indoor, so those records are represented as locations rather than verified 3D towers.

The user can search licensed sites by reported location, identifier, coordinates or licensee; the list shows up to eight nearest matches. Selecting a location displays licensee, record count, technologies, site type, antenna information and available IDs. The user can expand reported records, select a bearing, focus fans on a selected site and adjust fan intensity.

At zoom 14 and above, arrows indicate reported directional bearings. Qualifying purpose-built outdoor towers can be drawn as schematic 3D structures when all records at a coordinate agree on a valid reported structure height. The record data and model are not independent confirmation of the actual structure or current service.

== Radio planning fans

Bell locations with exactly three reported directional bearings and usable radio inputs can show three color-coded planning fans. A selected Bell site can also show usable bearings when it has a different bearing count. Colors represent bearing order, not a unique cell identity.

The estimate uses a 3GPP urban macro mean path-loss model with user-adjustable LOS or NLOS mode, assumed EIRP and received-power threshold. Defaults are NLOS, 46 dBm and -100 dBm. The overview fan is drawn at 5/12 of its calculated radius and uses a minimum displayed beamwidth of 15 degrees. The panel distinguishes calculated and displayed radius.

#block(fill: rgb("edf4ee"), inset: 10pt, radius: 3pt)[
  *Interpretation.* Fans are illustrative link-budget estimates. They are not measured coverage, RSRP or SINR results, and do not model buildings, terrain obstruction, interference, loading, fading or penetration loss. A Bell license does not prove TELUS service at an individual location.
]

= Project area features

== Default projects

When Toronto loads, the map shows a dashed boundary for each of its four projects. With no saved edit, the viewer chooses the eligible Bell location nearest the project center as an anchor, then the six eligible locations nearest that anchor. Eligibility requires three usable sector estimates under the default assumptions. There is no hard distance limit; the selected project panel reports the maximum distance from the first site so that a sparse cluster can be recognized.

For each project, the outline encloses the full-radius sector geometries of its current sites. It is a single convex hull, which may include gaps between fans. It is a project area, not a prediction that every point within it has service. Selecting a project fits its boundary in a top-down map view and lists the sites. On a phone, the network panel closes to make room; opening *Network* in the sidebar shows it again.

== Editing project sites

After selecting a Toronto project, right-click a visible Bell site and use the popup to add it to, or remove it from, that project. A site added through the UI must have three usable default-scenario sector estimates. The server saves the site IDs in SQLite; after the save succeeds, the site list, project boundary and fitted map view are updated. A failed save leaves the previous membership in place and provides a retry action.

The original project target is seven sites. Edits may produce a different count; the sidebar warns that seven are required for simulation. The application can still draw an enclosing boundary for a nonempty valid set, but it does not execute an NDT simulation. If a saved site disappears from the current source dataset, the affected project boundary and editing are unavailable rather than silently removing the missing site.

New York project shortcuts navigate to their configured locations, but project boundaries and editable radio site membership are unavailable because the reservation records do not contain the needed radio inputs.

= New York reservations

The New York view uses the NYC pole reservation snapshot filtered to franchisee NY SMSA, associated with Verizon. The downloaded snapshot described in the repository contains 701 records: 125 installed, 386 approved and 190 proposed. Installed and approved reservations appear as map markers. Proposed reservations remain searchable in the panel but are not drawn as markers. A selected reservation shows available street, borough, pole, status and date fields.

These are administrative reservations, not verified operating cell sites. They do not establish live service and do not supply antenna bearings, widths or frequencies. Consequently, the viewer does not generate New York sector fans or project coverage boundaries.

= Data, operation and limitations

- The supplied Toronto radio data is an ISED extract dated 2026-11-03; New York pole data was downloaded on 2026-11-07. Snapshot counts can change when the source data is rebuilt. OSM-derived roof, tree and street data is a dated extract, not a complete physical inventory.
- `make run` starts the local server on the first available port from 5179 through 5189. `PORT` selects an exact port. The default SQLite file is `regions.sqlite3` in the project root; project membership is stored there and should be backed up.
- On first startup without a root database, an existing `ndt/var/regions.sqlite3` is copied. Stop all older viewer processes before starting the new server to prevent subsequent edits from being split between the old and new files. An existing root database is not overwritten.
- The user-facing boundary is based on a fixed radio model, not site-specific surveyed equipment. The map can visualize indoor TELUS locations but does not calculate indoor coverage. The source does not support a per-site Bell/TELUS sharing assertion.
- The service binds to `127.0.0.1` by default. There is no implemented login or user-account system; if an operator changes the host binding, access to the service and project edits must be controlled outside the application.

= Source references

This document was checked against `ndt/regions.json`, `ndt/dist/app.js`, the roof, tree, street-detail and lighting modules, `ndt/dist/network-symbols.mjs`, `ndt/dist/radio-model.mjs`, `ndt/dist/project-coverage.mjs`, `ndt/dist/nyc-reservations.mjs`, the regional OSM manifests, `ndt/server.py`, `Makefile`, and `ndt/README.md`. The companion software design document describes the internal data flow and contracts.

= Detailed feature register

This register is a snapshot of the 129 features in `outputs/ndt-feature-inventory/feature_inventory.xlsx`, based on revision `836eec2`. IDs and implementation labels correspond to the workbook. Implemented means the behavior exists; Conditional means it requires the stated data or conditions; Not available identifies a current gap. The workbook is maintained separately, so changes made there are not automatically reflected in this document.

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
    columns: (23mm, 1.55fr, 2.6fr, 2.55fr),
    table.header([*ID*], [*Feature / scope*], [*User action and behavior*], [*Conditions and limitations*]),
    ..entries.map(row => (
      text(weight: "bold", row.at(0)),
      [*#(row.at(1))* #linebreak() #text(size: 8pt, fill: rgb("517465"))[#(row.at(3)) · #(row.at(4))]],
      [#(row.at(5)) #linebreak() #(row.at(6))],
      text(row.at(7)),
    )).flatten(),
  )
}
