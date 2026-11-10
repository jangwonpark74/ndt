import {featureDetails} from './map-data.mjs';

export function createMapSceneViewModel(options = {}) {
  const schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
  let timer = null;
  let state = {phase:'loading',selection:null};
  const listeners = new Set();
  const update = changes => {state = {...state,...changes}; for (const listener of listeners) listener(state);};
  return {
    getState: () => state,
    subscribe(listener) {listeners.add(listener); listener(state); return () => listeners.delete(listener);},
    start() {
      if (timer !== null || state.phase !== 'loading') return;
      timer = schedule(()=>{timer = null; if (state.phase === 'loading') update({phase:'error'});},20000);
    },
    loaded() {if (timer !== null) cancel(timer); timer = null; update({phase:'ready'});},
    select(features,location) {
      const candidates = features.filter(feature=>feature.source === 'openmaptiles');
      const feature = candidates.find(item=>item.sourceLayer === 'building') || candidates[0];
      update({selection:feature ? {location,height:featureDetails(feature).height} : null});
    },
  };
}
