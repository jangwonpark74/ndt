import { validBellOutdoorSite } from './network-data.mjs';
import { sectorFanFeatures } from './network-symbols.mjs?v=network-explorer-4';
import { RADIO_DEFAULTS } from './radio-model.mjs';
import { selectProjectSites } from './project-coverage.mjs?v=cluster-2';
import { validProjectUseCase } from './project-data.mjs';

export function createProjectModel(region, assetBase, fetcher = fetch) {
  const base = `/api/regions/${encodeURIComponent(region.id)}/projects`;
  return {
    async loadUseCases() {
      const response = await fetcher(`/api/regions/${encodeURIComponent(region.id)}/project-use-cases`);
      if (!response.ok) throw new Error('Could not load project use cases');
      const values = await response.json();
      if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.entries(values).every(([id,value])=>region.projects.some(project=>project.id === id) && validProjectUseCase(value))) throw new Error('Invalid project use cases');
      return values;
    },
    async saveUseCase(projectId, useCase) {
      if (!validProjectUseCase(useCase)) throw new Error('Invalid project use case');
      const response = await fetcher(`${base}/${encodeURIComponent(projectId)}/use-case`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({useCase}),
      });
      if (!response.ok) throw new Error('Could not save project use case');
      const accepted = await response.json();
      if (!accepted || accepted.useCase !== useCase) throw new Error('Invalid saved project use case');
      return accepted.useCase;
    },
    async load() {
      const responses = await Promise.all([fetcher(`${assetBase}/bell-outdoor-sites.geojson`), fetcher(base)]);
      if (responses.some(response => !response.ok)) throw new Error('Project site data unavailable');
      const [data, saved] = await Promise.all(responses.map(response => response.json()));
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.every(validBellOutdoorSite) || data.features.reduce((sum,f)=>sum+f.properties.record_count,0) !== data.record_count || new Set(data.features.map(f=>f.properties.site_id)).size !== data.features.length) throw new Error('Invalid project site data');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid saved projects');
      const sitesById = new Map(data.features.map(site => [site.properties.site_id, site]));
      const counts = new Map();
      for (const fan of sectorFanFeatures(data.features,RADIO_DEFAULTS).features) counts.set(fan.properties.site_id,(counts.get(fan.properties.site_id)||0)+1);
      const eligible = new Set([...counts].filter(([,count])=>count === 3).map(([id])=>id));
      const missing = new Set();
      const clusters = new Map(region.projects.map(project => {
        if (!Object.hasOwn(saved,project.id)) return [project.id,selectProjectSites(data.features,project.center)];
        const ids = saved[project.id];
        if (!Array.isArray(ids) || !ids.every(id=>typeof id === 'string') || new Set(ids).size !== ids.length) throw new Error('Invalid saved site list');
        if (ids.some(id=>!sitesById.has(id))) missing.add(project.id);
        return [project.id,ids.map(id=>sitesById.get(id)).filter(Boolean)];
      }));
      return {clusters, sitesById, eligible, missing};
    },
    async save(projectId, ids) {
      const response = await fetcher(`${base}/${encodeURIComponent(projectId)}/sites`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(ids),
      });
      if (!response.ok) throw new Error('Could not save project sites');
    },
  };
}
