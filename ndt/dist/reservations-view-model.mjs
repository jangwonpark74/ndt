export function createReservationsViewModel(model) {
  let state = {visible:false, features:null, loading:false, error:false, query:'', selected:null};
  let promise;
  const listeners = new Set();
  const update = changes => { state = {...state,...changes}; for (const listener of listeners) listener(state); };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    setVisible(visible) { update({visible}); },
    setQuery(query) { update({query}); },
    select(feature) { update({selected:feature}); },
    load() {
      if (state.features) return Promise.resolve(state.features);
      if (!promise) {
        update({loading:true,error:false});
        promise = model.load().then(features => { update({features,loading:false}); return features; })
          .catch(error => { update({loading:false,error:true}); throw error; })
          .finally(() => { promise = null; });
      }
      return promise;
    },
    results(contains, center) {
      if (!state.features) return null;
      const query = state.query.trim().toLowerCase();
      const nearby = state.features.filter(f=>contains(f.geometry.coordinates));
      const results = (query ? state.features.filter(f=>Object.values(f.properties).some(v=>String(v).toLowerCase().includes(query))) : nearby).slice();
      results.sort((a,b)=>Math.hypot(a.geometry.coordinates[0]-center.lng,a.geometry.coordinates[1]-center.lat)-Math.hypot(b.geometry.coordinates[0]-center.lng,b.geometry.coordinates[1]-center.lat));
      return {inView:nearby.filter(f=>f.properties.status !== 'Proposed').length, total:state.features.length, count:results.length, query:!!query, features:results.slice(0,8)};
    },
  };
}
