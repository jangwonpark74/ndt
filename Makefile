UV ?= uv
NODE ?= node
HOST ?= 127.0.0.1
PORT ?= 5179
UV_CACHE_DIR ?= $(CURDIR)/.cache/uv
export UV_CACHE_DIR

.PHONY: help setup run test check

help:
	@printf '%s\n' 'make setup  Create the local Python environment' \
		'make run    Start the viewer (HOST=127.0.0.1 PORT=5179)' \
		'make test   Run the OSM parsing tests' \
		'make check  Check source syntax and run tests'

setup:
	$(UV) sync --locked

run:
	cd viewer && $(UV) run --locked python -m http.server $(PORT) --bind $(HOST) --directory dist

test:
	cd viewer && $(NODE) test.mjs
	cd viewer && $(NODE) test-roofs.mjs
	cd viewer && $(NODE) test-trees.mjs
	cd viewer && $(NODE) test-shadows.mjs
	cd viewer && $(NODE) test-lighting.mjs
	cd viewer && $(NODE) test-search.mjs
	cd viewer && $(NODE) test-network.mjs
	cd viewer && $(NODE) test-network-symbols.mjs
	cd viewer && $(NODE) test-radio-model.mjs
	cd viewer && $(NODE) test-street-detail.mjs
	cd viewer && $(UV) run --locked python -B test-tree-sampling.py
	cd viewer && $(UV) run --locked python -B test-telus-matching.py
	cd viewer && $(UV) run --locked python -B test-telus-sites.py
	cd viewer && $(UV) run --locked python -B test-bell-outdoor.py

check: test
	cd viewer && $(NODE) --check dist/app.js
	cd viewer && $(NODE) --check dist/osm.mjs
	cd viewer && $(NODE) --check dist/map-data.mjs
	cd viewer && $(NODE) --check dist/roof-layer.mjs
	cd viewer && $(NODE) --check dist/roof-geometry.mjs
	cd viewer && $(NODE) --check dist/tree-layer.mjs
	cd viewer && $(NODE) --check dist/tree-data.mjs
	cd viewer && $(NODE) --check dist/lighting.mjs
	cd viewer && $(NODE) --check dist/shadows.mjs
	cd viewer && $(NODE) --check dist/search.mjs
	cd viewer && $(NODE) --check dist/network-layer.mjs
	cd viewer && $(NODE) --check dist/network-symbols.mjs
	cd viewer && $(NODE) --check dist/radio-model.mjs
	cd viewer && $(NODE) --check dist/street-detail.mjs
	cd viewer && $(UV) run --locked python -c "import ast, pathlib; [ast.parse(pathlib.Path(p).read_text()) for p in ('convert_osm.py', 'scripts/extract_roofs.py', 'scripts/extract_trees.py', 'scripts/extract_street_detail.py', 'scripts/extract_network.py', 'scripts/match_telus.py', 'scripts/extract_telus_sites.py', 'scripts/extract_bell_outdoor.py', 'scripts/tree_sampling.py')]"
