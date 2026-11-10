import { siteClass, towerHeight } from './network-data.mjs';
import { sitePattern, sectorFeatures, sectorFanFeatures, siteMatchesQuery, sitesWithFansOrIndoor } from './network-symbols.mjs?v=network-explorer-4';

const empty = {type:'FeatureCollection',features:[]};
export function markerClass(feature) { return feature.properties.provider === 'Bell' ? 'bell' : siteClass(feature.properties.records); }

export function createNetworkViewModel(model) {
  let state = {features:null,loading:false,error:false,selected:null,sector:null,query:'',telus:false,bell:false,fansVisible:false,focus:false,scenario:null};
  let promise;
  const listeners = new Set();
  const update = changes => {state = {...state,...changes}; for (const listener of listeners) listener(state);};
  const active = () => (state.features || []).filter(feature=>feature.properties.provider === 'Bell' ? state.bell : state.telus);
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    setOptions(options) { update(options); },
    select(feature, sector = null) { update({selected:feature,sector}); },
    setSector(sector) { update({sector}); },
    load() {
      if (state.features) return Promise.resolve(state.features);
      if (!promise) {
        update({loading:true,error:false});
        promise = model.load().then(features=>{ update({features,loading:false}); return features; })
          .catch(error=>{ update({loading:false,error:true}); throw error; })
          .finally(()=>{ promise = null; });
      }
      return promise;
    },
    list(contains, center, zoom) {
      if ((!state.telus && !state.bell) || !state.features) return null;
      const inView = active().filter(feature=>contains(feature.geometry.coordinates));
      const query = state.query.trim(), features = query ? active().filter(feature=>siteMatchesQuery(feature,query)) : inView.slice();
      const distance = f => Math.hypot((f.geometry.coordinates[0]-center.lng)*Math.cos(center.lat*Math.PI/180),f.geometry.coordinates[1]-center.lat);
      features.sort((a,b)=>distance(a)-distance(b));
      const towers = inView.filter(feature=>towerHeight(feature.properties.records) !== null).length;
      const telus = inView.filter(feature=>feature.properties.provider !== 'Bell').length, bell = inView.length-telus;
      return {
        status:`In view: ${telus} TELUS coordinates · ${bell} Bell outdoor coordinates · ${towers} towers with reported height${zoom < 14 ? ' · Zoom in for directional symbols' : ''}`,
        listStatus:query ? `${features.length.toLocaleString()} matching locations${features.length > 8 ? ' · showing nearest 8' : ''}` : `Nearby locations${features.length > 8 ? ' · showing nearest 8' : ''}`,
        features:features.slice(0,8),
      };
    },
    coverage() {
      const scenario = state.scenario || {};
      const valid = Number.isFinite(scenario.eirpDbm) && scenario.eirpDbm >= 0 && scenario.eirpDbm <= 90 && Number.isFinite(scenario.thresholdDbm) && scenario.thresholdDbm >= -160 && scenario.thresholdDbm <= -20;
      const allFans = valid ? sectorFanFeatures(active(),scenario) : empty;
      const markers = sitesWithFansOrIndoor(active(),allFans);
      const markerFeatures = {type:'FeatureCollection',features:markers.map(feature=>({type:'Feature',geometry:feature.geometry,properties:{site_id:feature.properties.site_id,site_class:markerClass(feature),antenna_pattern:feature.properties.provider === 'Bell' ? 'unknown' : sitePattern(feature.properties.records)}}))};
      const result = {markers,markerFeatures,sectors:sectorFeatures(markers),fans:empty,selectedFans:empty,status:''};
      if (!state.fansVisible) result.status = 'Planning estimate is off.';
      else if (!state.bell) result.status = 'Enable Bell outdoor to see planning estimates.';
      else if (!state.features) result.status = 'Loading network records…';
      else if (!valid) result.status = 'Enter EIRP 0–90 dBm and received-power threshold −160 to −20 dBm.';
      else {
        const selected = state.selected?.properties.provider === 'Bell' ? sectorFanFeatures([state.selected],scenario,{includeOtherBearingCounts:true}) : empty;
        const fans = state.focus ? selected : allFans;
        result.fans = fans; result.selectedFans = selected;
        if (state.focus && !state.selected) result.status = 'Select a Bell outdoor site to focus its fans.';
        else if (!fans.features.length) result.status = 'No estimates: usable bearings, frequencies and beamwidths and a link budget reaching at least 10 m are required.';
        else {
          const count = new Set(fans.features.map(f=>f.properties.site_id)).size;
          result.status = `${fans.features.length.toLocaleString()} bearing estimates at ${count.toLocaleString()} Bell locations · fans drawn at 5/12 of calculated radius.${selected.features.length ? ` Selected: ${selected.features.map(f=>`${f.properties.azimuth}°: ${(f.properties.radius_m/1000).toFixed(2)} km calculated, ${(f.properties.display_radius_m/1000).toFixed(2)} km shown at ${f.properties.frequency_mhz} MHz${f.properties.status === 'capped-at-5km' ? ' (5 km model limit)' : ''}`).join(' · ')}.` : ''}`;
        }
      }
      return result;
    },
  };
}
