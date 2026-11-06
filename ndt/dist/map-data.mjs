export function layerGroups(layers) {
  return {
    streets: layers.filter(layer => ['transportation', 'transportation_name'].includes(layer['source-layer'])).map(layer => layer.id),
    buildings: layers.filter(layer => layer['source-layer'] === 'building').map(layer => layer.id),
  };
}
export function featureDetails(feature) {
  const attributes = feature.properties || {};
  const match = String(attributes.osm_id || '').match(/^(node|way|relation)\/(\d+)$/);
  const height = Number(attributes.render_height);
  return {
    name: attributes.name || feature.sourceLayer?.replaceAll('_', ' ') || 'Map feature',
    attributes: Object.entries(attributes).filter(([key]) => key !== 'name'),
    osmLink: match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : null,
    height: feature.sourceLayer === 'building' && Number.isFinite(height) && height > 0 ? height : 0,
  };
}
