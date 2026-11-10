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

export async function searchLocations(query, center, signal) {
  const params = new URLSearchParams({q:query, limit:'5', lat:String(center.lat), lon:String(center.lng)});
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once:true});
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {signal:controller.signal});
    if (!response.ok) throw new Error('Search service unavailable');
    return searchResults(await response.json());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
