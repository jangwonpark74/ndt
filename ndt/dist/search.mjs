export function searchResults(data) {
  if (!Array.isArray(data?.features)) return [];
  return data.features.flatMap(feature => {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2 ||
        !coordinates.slice(0,2).every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90 ||
        !properties || typeof properties !== 'object') return [];
    const address = [properties.housenumber, properties.street].filter(value => typeof value === 'string' && value.trim()).join(' ');
    const parts = [properties.name, address, properties.city, properties.state, properties.country]
      .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    const label = [...new Set(parts)].join(', ');
    return label ? [{label, coordinates:coordinates.slice(0,2)}] : [];
  }).slice(0,5);
}
