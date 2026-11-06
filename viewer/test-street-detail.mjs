import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = new URL('./dist/street-detail/',import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json',base)));
const counts = {lamp:0,bench:0};
for (const [key,expected] of Object.entries(manifest.tiles)) {
  const records = JSON.parse(await readFile(new URL(`${key}.json`,base)));
  assert.equal(records.length,expected);
  for (const [lon,lat,kind] of records) {
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat) && Object.hasOwn(counts,kind));
    counts[kind]++;
  }
}
assert.deepEqual(counts,manifest.counts,'street tiles retain all extracted mapped points');
assert.ok(counts.lamp > 0 && counts.bench > 0);
console.log('Mapped street detail tile integrity passed.');
