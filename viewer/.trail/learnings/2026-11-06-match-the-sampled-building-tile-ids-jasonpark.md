---
title: Match the sampled building tile IDs before replacing roofs
author: Jasonpark
date: 2026-11-06
branch: main
id: l-826bb9df
scope: repo
status: active
src: agent
touches:
  - dist/roof-layer.mjs
  - scripts/extract_roofs.py
---

## Decided
Match Toronto roof ways against the two ID suffixes observed in the sampled tile and relations against the observed relation suffix. Keep the tile building whenever geometry is unsupported or the tile marks it hidden.

## Tried and ruled out
Matching only one suffix omitted real roof-bearing ways in the sampled tile. Treating a multipolygon as a single solid ring would fill courtyards and hide the original building, so only flat and skillion roofs with holes are rendered; other courtyard shapes retain the tile fallback.

## Watch out
This is evidence from one provider tile, not a universal OSM ID convention. Verify the mapping if the provider or schema changes; a matched relation can still have hide_3d set. The scene uses a single terrain elevation per building, not a surveyed foundation.

In the code: way 110166031 appeared as tile feature 1101660312; relation 37964 appeared as 379643 in the sampled Toronto building tile. The PBF SHA-256 is in README.md.
