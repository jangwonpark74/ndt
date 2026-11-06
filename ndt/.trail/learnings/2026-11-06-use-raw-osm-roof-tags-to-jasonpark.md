---
title: Use raw OSM roof tags to replace flat tiled buildings
author: Jasonpark
date: 2026-11-06
branch: main
id: l-5b926e27
scope: repo
status: active
src: agent
touches:
  - Makefile
  - README.md
  - dist/app.js
  - dist/index.html
---

## Decided
Use the Toronto OSM extract to provide roof tags and geometry, and replace a native tile extrusion only after its corresponding roof geometry has been created. Keep the native extrusion for unsupported or invalid shapes, unmatched IDs, and missing data so buildings do not disappear.

## Tried and ruled out
The OpenFreeMap building tile schema supplies rendered heights and colour but not roof shape or direction, so styling that layer alone cannot reconstruct mapped roof types. Public Overpass endpoints were unavailable during this investigation, so a dated BBBike extract gives reproducible city-wide coverage without a live Overpass dependency.

## Watch out
The sampled OpenFreeMap z14 building tile encoded matching OSM way IDs as the way ID multiplied by 10; this is a provider-specific observation, not a universal OSM rule. Check the mapping again if the tile provider or schema changes. Roof geometry is anchored to sampled terrain and unsupported footprints must retain their native extrusion.

In the code: `dist/toronto-roofs.json`, `dist/roof-layer.mjs`, `dist/roof-geometry.mjs`, and `scripts/extract_roofs.py`. The tested Toronto way 951725944 matched tile ID 9517259440. The source PBF was dated 2026-10-31 and its SHA-256 is recorded in README.md.
