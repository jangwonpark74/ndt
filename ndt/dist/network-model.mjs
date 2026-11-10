import { validTelusSite, validBellOutdoorSite } from './network-data.mjs';

export function siteLocations(feature) {
  return [...new Set((feature.properties.locations || feature.properties.records.map(record=>record.location)).filter(value=>typeof value === 'string' && value.trim()).map(value=>value.trim()))];
}

export function createNetworkModel(assetBase, fetcher = fetch) {
  return {
    async load() {
      const responses = await Promise.all(['telus-sites.geojson','bell-outdoor-sites.geojson'].map(name=>fetcher(`${assetBase}/${name}`)));
      if (responses.some(response=>!response.ok)) throw new Error('Network data request failed');
      const datasets = await Promise.all(responses.map(response=>response.json()));
      for (const [index,data] of datasets.entries()) {
        const valid = index ? validBellOutdoorSite : validTelusSite;
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.every(valid) ||
            data.features.reduce((sum,f)=>sum+f.properties.record_count,0) !== data.record_count ||
            new Set(data.features.map(f=>f.properties.site_id)).size !== data.features.length) throw new Error('Invalid network site data');
      }
      return datasets.flatMap(data=>data.features);
    },
  };
}
