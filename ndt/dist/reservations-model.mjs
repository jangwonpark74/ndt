export function createReservationsModel(base, fetcher = fetch) {
  return {
    async load() {
      const response = await fetcher(`${base}/verizon-poles.geojson`);
      if (!response.ok) throw new Error('Reservation data unavailable');
      const data = await response.json();
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.every(f=>f.geometry?.type === 'Point' && f.geometry.coordinates?.length === 2 && f.geometry.coordinates.every(Number.isFinite) && typeof f.properties?.id === 'string')) throw new Error('Invalid reservation data');
      return data.features;
    },
  };
}
