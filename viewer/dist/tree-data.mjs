export const TREE_MIN_ZOOM = 15;
export function canopyDetail(record, center) {
  const dy = (record[1] - center.lat) * 111320;
  const dx = (record[0] - center.lng) * 111320 * Math.cos(center.lat * Math.PI / 180);
  return Math.max(0, Math.min(1, (1300 - Math.hypot(dx, dy)) / 600));
}
export function treeSize(record) {
  const height = Number(record[2]), diameter = Number(record[3]);
  const h = Number.isFinite(height) && height >= 2 && height <= 60 ? height : 8;
  return {height:h, diameter:Number.isFinite(diameter) && diameter >= 1 && diameter <= 40 ? diameter : Math.max(3, h * .55), conifer:record[4] === 1};
}
export function visibleTreeTiles(manifest, bounds) {
  const n = 2 ** manifest.zoom;
  const tileX = lon => Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
  const tileY = lat => {
    const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
    return Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n)));
  };
  const west = tileX(bounds.getWest()), east = tileX(bounds.getEast()), north = tileY(bounds.getNorth()), south = tileY(bounds.getSouth());
  return Object.keys(manifest.tiles).filter(key => {
    const [x,y] = key.split('/').map(Number);
    return x >= west && x <= east && y >= north && y <= south;
  }).sort();
}
