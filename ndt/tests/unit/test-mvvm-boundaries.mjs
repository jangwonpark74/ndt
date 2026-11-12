import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dist = fileURLToPath(new URL('../../dist/',import.meta.url));
const roots = fs.readdirSync(dist,{recursive:true}).filter(name=>name.endsWith('-view-model.mjs'));
assert.ok(roots.length >= 6,'the application has separate view-models');
for (const root of roots) {
  const visited = new Set();
  function verify(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source,/\b(?:document|window|maplibregl|fetch|requestAnimationFrame|cancelAnimationFrame)\b/,`${root}: ${path.basename(file)} must be independent of browser views and network`);
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const specifier = match[1].split('?')[0];
      assert.ok(specifier.startsWith('./') && !specifier.includes('/vendor/') && !specifier.endsWith('-view.mjs'),`${root}: forbidden dependency ${specifier}`);
      verify(path.resolve(path.dirname(file),specifier));
    }
  }
  verify(path.join(dist,root));
}
console.log('View-model dependency boundaries passed.');
