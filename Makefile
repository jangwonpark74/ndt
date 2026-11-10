UV ?= uv
NODE ?= node
HOST ?= 127.0.0.1
UV_CACHE_DIR ?= $(CURDIR)/.cache/uv
export UV_CACHE_DIR

.PHONY: help setup run test test-ui check

help:
	@printf '%s\n' 'make setup  Create the local Python environment' \
		'make run    Start the viewer (HOST=127.0.0.1, default ports 5179–5189)' \
		'make test   Run the viewer tests' \
		'make test-ui  Run Playwright UI tests' \
		'make check  Check source syntax and run tests'

setup:
	$(UV) sync --locked

run:
	$(UV) run --locked python ndt/server.py --host $(HOST) $(if $(filter undefined,$(origin PORT)),,--port $(PORT))

test:
	cd ndt && $(NODE) tests/test.mjs
	cd ndt && $(NODE) tests/test-roofs.mjs
	cd ndt && $(NODE) tests/test-trees.mjs
	cd ndt && $(NODE) tests/test-shadows.mjs
	cd ndt && $(NODE) tests/test-lighting.mjs
	cd ndt && $(NODE) tests/test-search.mjs
	cd ndt && $(NODE) tests/test-search-view-model.mjs
	cd ndt && $(NODE) tests/test-network.mjs
	cd ndt && $(NODE) tests/test-network-symbols.mjs
	cd ndt && $(NODE) tests/test-network-view-model.mjs
	cd ndt && $(NODE) tests/test-radio-model.mjs
	cd ndt && $(NODE) tests/test-project-coverage.mjs
	cd ndt && $(NODE) tests/test-tasks.mjs
	cd ndt && $(NODE) tests/test-project-view-model.mjs
	cd ndt && $(NODE) tests/test-reservations-view-model.mjs
	cd ndt && $(NODE) tests/test-region-view-model.mjs
	cd ndt && $(NODE) tests/test-map-controls-view-model.mjs
	cd ndt && $(NODE) tests/test-map-scene-view-model.mjs
	cd ndt && $(NODE) tests/test-navigation-view-model.mjs
	cd ndt && $(NODE) tests/test-mvvm-boundaries.mjs
	cd ndt && $(NODE) tests/test-street-detail.mjs
	cd ndt && $(UV) run --locked python -B tests/test-tree-sampling.py
	cd ndt && $(UV) run --locked python -B tests/test-telus-matching.py
	cd ndt && $(UV) run --locked python -B tests/test-telus-sites.py
	cd ndt && $(UV) run --locked python -B tests/test-bell-outdoor.py
	cd ndt && $(UV) run --locked python -B tests/test-convert-osm.py
	cd ndt && $(UV) run --locked python -B tests/test-regions.py
	cd ndt && $(UV) run --locked python -B tests/test-road-routing.py
	cd ndt && $(UV) run --locked python -B tests/test-task-store.py

test-ui:
	npm run test:ui

check: test
	cd ndt && $(NODE) --check dist/task-data.mjs
	cd ndt && $(NODE) --check dist/virtual-ue-view.mjs
	cd ndt && $(NODE) --check dist/task-model.mjs
	cd ndt && $(NODE) --check dist/task-view-model.mjs
	cd ndt && $(NODE) --check dist/task-view.mjs
	cd ndt && $(NODE) --check dist/task-table-view.mjs
	cd ndt && $(NODE) --check dist/task-format.mjs
	cd ndt && $(NODE) --check dist/context-panel.mjs
	cd ndt && $(NODE) --check dist/app.js
	cd ndt && $(NODE) --check dist/osm.mjs
	cd ndt && $(NODE) --check dist/map-data.mjs
	cd ndt && $(NODE) --check dist/roof-layer.mjs
	cd ndt && $(NODE) --check dist/roof-geometry.mjs
	cd ndt && $(NODE) --check dist/tree-layer.mjs
	cd ndt && $(NODE) --check dist/tree-data.mjs
	cd ndt && $(NODE) --check dist/lighting.mjs
	cd ndt && $(NODE) --check dist/shadows.mjs
	cd ndt && $(NODE) --check dist/search.mjs
	cd ndt && $(NODE) --check dist/search-view-model.mjs
	cd ndt && $(NODE) --check dist/search-view.mjs
	cd ndt && $(NODE) --check dist/network-layer.mjs
	cd ndt && $(NODE) --check dist/network-data.mjs
	cd ndt && $(NODE) --check dist/network-symbols.mjs
	cd ndt && $(NODE) --check dist/network-model.mjs
	cd ndt && $(NODE) --check dist/network-view-model.mjs
	cd ndt && $(NODE) --check dist/network-view.mjs
	cd ndt && $(NODE) --check dist/nyc-reservations.mjs
	cd ndt && $(NODE) --check dist/reservations-model.mjs
	cd ndt && $(NODE) --check dist/reservations-view-model.mjs
	cd ndt && $(NODE) --check dist/region-model.mjs
	cd ndt && $(NODE) --check dist/region-view-model.mjs
	cd ndt && $(NODE) --check dist/region-view.mjs
	cd ndt && $(NODE) --check dist/map-controls-view-model.mjs
	cd ndt && $(NODE) --check dist/map-controls-view.mjs
	cd ndt && $(NODE) --check dist/map-scene-view-model.mjs
	cd ndt && $(NODE) --check dist/map-scene-view.mjs
	cd ndt && $(NODE) --check dist/navigation-view-model.mjs
	cd ndt && $(NODE) --check dist/navigation-view.mjs
	cd ndt && $(NODE) --check dist/project-coverage.mjs
	cd ndt && $(NODE) --check dist/project-model.mjs
	cd ndt && $(NODE) --check dist/project-data.mjs
	cd ndt && $(NODE) --check dist/project-view-model.mjs
	cd ndt && $(NODE) --check dist/project-view.mjs
	cd ndt && $(NODE) --check dist/radio-model.mjs
	cd ndt && $(NODE) --check dist/street-detail.mjs
	cd ndt && $(UV) run --locked python -c "import ast, pathlib; [ast.parse(pathlib.Path(p).read_text()) for p in ('scripts/convert_osm.py', 'scripts/extract_roofs.py', 'scripts/extract_trees.py', 'scripts/extract_street_detail.py', 'scripts/extract_network.py', 'scripts/match_telus.py', 'scripts/extract_telus_sites.py', 'scripts/extract_bell_outdoor.py', 'scripts/tree_sampling.py')]"
