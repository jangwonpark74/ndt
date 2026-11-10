export function createRegionModel(fetcher = fetch) {
  return {
    async load() {
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),8000);
      try {
        const response = await fetcher('/api/regions',{signal:controller.signal});
        if (!response.ok) throw new Error('Region catalog unavailable');
        const regions = await response.json();
        if (!Array.isArray(regions) || !regions.length) throw new Error('Invalid region catalog');
        return regions;
      } finally { clearTimeout(timer); }
    },
  };
}
