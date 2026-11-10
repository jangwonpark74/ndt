export function createRegionViewModel(model, initialId) {
  let state = {regions:[],region:null,loading:false,error:false};
  const listeners = new Set();
  const update = changes => {state = {...state,...changes}; for (const listener of listeners) listener(state);};
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async load() {
      update({loading:true,error:false});
      try {
        const regions = await model.load(), region = regions.find(item=>item.id === initialId) || regions[0];
        update({regions,region,loading:false});
        return region;
      } catch (error) { update({loading:false,error:true}); throw error; }
    },
    assetBase() { return `/api/regions/${encodeURIComponent(state.region.id)}/assets`; },
    regionUrl(id, currentUrl) {
      if (id === state.region.id || !state.regions.some(region=>region.id === id)) return null;
      const url = new URL(currentUrl); url.searchParams.set('region',id); return url.href;
    },
  };
}
