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
	cd ndt && $(NODE) tests/unit/test.mjs
	cd ndt && $(NODE) tests/unit/test-roofs.mjs
	cd ndt && $(NODE) tests/unit/test-trees.mjs
	cd ndt && $(NODE) tests/unit/test-shadows.mjs
	cd ndt && $(NODE) tests/unit/test-lighting.mjs
	cd ndt && $(NODE) tests/unit/test-search.mjs
	cd ndt && $(NODE) tests/unit/test-search-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-network.mjs
	cd ndt && $(NODE) tests/unit/test-network-symbols.mjs
	cd ndt && $(NODE) tests/unit/test-network-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-radio-model.mjs
	cd ndt && $(NODE) tests/unit/test-planning.mjs
	cd ndt && $(NODE) tests/unit/test-carrier-plan.mjs
	cd ndt && $(NODE) tests/unit/test-scenario-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-equipment-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-fixture-cleanup.cjs
	cd ndt && $(NODE) tests/unit/test-project-coverage.mjs
	cd ndt && $(NODE) tests/unit/test-tasks.mjs
	cd ndt && $(NODE) tests/unit/test-project-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-reservations-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-region-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-map-controls-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-map-scene-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-navigation-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-mvvm-boundaries.mjs
	cd ndt && $(NODE) tests/unit/test-street-detail.mjs
	cd ndt && $(NODE) tests/unit/test-dm-analytics.mjs
	cd ndt && $(NODE) tests/unit/test-dm-view-model.mjs
	cd ndt && $(NODE) tests/unit/test-drive-model-parity.mjs
	cd ndt && $(NODE) tests/unit/test-scenario-run-view-model.mjs
	cd ndt && $(UV) run --locked python -B tests/python/test-tree-sampling.py
	cd ndt && $(UV) run --locked python -B tests/python/test-telus-matching.py
	cd ndt && $(UV) run --locked python -B tests/python/test-telus-sites.py
	cd ndt && $(UV) run --locked python -B tests/python/test-bell-outdoor.py
	cd ndt && $(UV) run --locked python -B tests/python/test-convert-osm.py
	cd ndt && $(UV) run --locked python -B tests/python/test-regions.py
	cd ndt && $(UV) run --locked python -B tests/python/test-road-routing.py
	cd ndt && $(UV) run --locked python -B tests/python/test-task-store.py
	cd ndt && $(UV) run --locked python -B tests/python/test-radio-scenarios.py
	cd ndt && $(UV) run --locked python -B tests/python/test-carrier-plan.py
	cd ndt && $(UV) run --locked python -B tests/python/test-equipment-inventory.py
	cd ndt && $(UV) run --locked python -B tests/python/test-dm-model.py
	cd ndt && $(UV) run --locked python -B tests/python/test-drive-integration.py
	cd ndt && $(UV) run --locked python -B tests/python/test-directional-radio.py
	cd ndt && $(UV) run --locked python -B tests/python/test-drive-http.py

test-ui:
	npm run test:ui

check: test
	$(NODE) --input-type=module -e "import fs from 'node:fs'; import cp from 'node:child_process'; for(const f of fs.readdirSync('ndt/dist/drive-test').filter(f=>/\.(mjs|js)$$/.test(f))) cp.execFileSync(process.execPath,['--check','ndt/dist/drive-test/'+f]);"
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
	cd ndt && $(NODE) --check dist/planning-model.mjs
	cd ndt && $(NODE) --check dist/carrier-plan.mjs
	cd ndt && $(NODE) --check dist/planning-view.mjs
	cd ndt && $(NODE) --check dist/planning-label-view.mjs
	cd ndt && $(NODE) --check dist/scenario-model.mjs
	cd ndt && $(NODE) --check dist/equipment-model.mjs
	cd ndt && $(NODE) --check dist/equipment-view-model.mjs
	cd ndt && $(NODE) --check dist/equipment-view.mjs
	cd ndt && $(NODE) --check dist/scenario-view-model.mjs
	cd ndt && $(NODE) --check dist/street-detail.mjs
	cd ndt && $(UV) run --locked python -c "import ast, pathlib; [ast.parse(pathlib.Path(p).read_text()) for p in ('scripts/convert_osm.py', 'scripts/extract_roofs.py', 'scripts/extract_trees.py', 'scripts/extract_street_detail.py', 'scripts/extract_network.py', 'scripts/match_telus.py', 'scripts/extract_telus_sites.py', 'scripts/extract_bell_outdoor.py', 'scripts/tree_sampling.py')]"
