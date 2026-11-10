export function createSearchViewModel(search) {
  let state = {query:'', open:false, loading:false, status:'', results:[]};
  let request = 0, controller;
  const listeners = new Set();
  const update = changes => {
    state = {...state, ...changes};
    for (const listener of listeners) listener(state);
  };
  const cancel = () => { request++; controller?.abort(); controller = null; };
  return {
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    setQuery(query) { cancel(); update({query, open:false, loading:false, status:'', results:[]}); },
    dismiss() { cancel(); update({open:false, loading:false}); },
    select(result) { cancel(); update({query:result.label, open:false, loading:false}); },
    async submit(center) {
      const query = state.query.trim();
      if (!query) return false;
      cancel();
      const current = request;
      controller = new AbortController();
      update({open:true, loading:true, status:'Searching…', results:[]});
      try {
        const results = await search(query, center, controller.signal);
        if (current === request) update({loading:false, status:results.length ? 'Choose a location' : 'No locations found.', results});
      } catch {
        if (current === request) update({loading:false, status:'Search unavailable. Please try again.', results:[]});
      }
      return true;
    },
  };
}
