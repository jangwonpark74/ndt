import { distanceMetres, projectCoverage } from './project-coverage.mjs?v=cluster-2';
import { validProjectUseCase } from './project-data.mjs';

export function createProjectViewModel(model, projects = []) {
  let state = {selected:null, data:null, loading:false, saving:false, useCases:null, useCasesLoading:false, useCasesError:'', pendingUseCase:null, useCaseNotice:null};
  let promise = null, useCasePromise = null, selection = 0;
  const listeners = new Set();
  const update = changes => {
    state = {...state, ...changes};
    for (const listener of listeners) listener(state);
  };
  function load() {
    if (state.data) return Promise.resolve(state.data);
    if (!promise) {
      update({loading:true});
      promise = model.load().then(data => { update({data,loading:false}); return data; })
        .catch(error => { update({loading:false}); throw error; })
        .finally(() => { promise = null; });
    }
    return promise;
  }
  function loadUseCases() {
    if (state.useCases) return Promise.resolve(state.useCases);
    if (!useCasePromise) {
      update({useCasesLoading:true, useCasesError:''});
      useCasePromise = model.loadUseCases().then(useCases=>{update({useCases, useCasesLoading:false}); return useCases;})
        .catch(error=>{update({useCasesLoading:false, useCasesError:'Use cases unavailable. Retry loading.'}); throw error;})
        .finally(()=>{useCasePromise=null;});
    }
    return useCasePromise;
  }
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    load,
    loadUseCases,
    async changeUseCase(project, value) {
      if (state.pendingUseCase) return false;
      if (!state.useCases || !projects.some(item=>item.id === project.id) || !validProjectUseCase(value)) throw new Error('Project use case editing unavailable');
      update({pendingUseCase:{projectId:project.id, value}, useCaseNotice:null});
      try {
        const accepted = await model.saveUseCase(project.id,value);
        update({useCases:{...state.useCases,[project.id]:accepted}, useCaseNotice:{projectId:project.id,text:'Use case saved.'}});
        return true;
      } catch (error) {
        update({useCaseNotice:{projectId:project.id,text:'Could not save use case. Choose again to retry.'}});
        throw error;
      } finally { update({pendingUseCase:null}); }
    },
    coverage(scenario) {
      if (!state.data) return null;
      const {clusters, missing} = state.data, boundaries = [];
      for (const project of projects) {
        if (missing.has(project.id)) continue;
        try {
          const feature = projectCoverage(clusters.get(project.id),scenario);
          if (feature) { feature.properties.project_id = project.id; boundaries.push(feature); }
        } catch (error) { console.warn('Project boundary:',error); }
      }
      if (!state.selected) return {boundaries, sites:[], boundary:null, status:''};
      const sites = clusters.get(state.selected.id), boundary = boundaries.find(feature=>feature.properties.project_id === state.selected.id);
      let status;
      if (missing.has(state.selected.id)) status = 'Saved project sites are missing from the current data. Boundary and editing are unavailable.';
      else if (!boundary) status = sites.length ? 'Boundary unavailable: usable sector estimates and valid planning assumptions are required.' : 'No project sites. Right-click an eligible Bell site to add it; seven are required for simulation.';
      else {
        const radius = Math.max(...sites.map(site=>distanceMetres(site.geometry.coordinates,sites[0].geometry.coordinates)));
        status = `${sites.length} Bell locations · cluster radius ${(radius/1000).toFixed(2)} km · ${sites.length === 7 ? '' : '7 sites required for simulation · '}full-radius project boundary includes gaps; not measured coverage. Right-click a Bell site to edit the project.`;
      }
      return {boundaries, sites, boundary, status};
    },
    async select(project, needsData = true) {
      const request = ++selection;
      update({selected:project, useCaseNotice:null});
      if (!needsData) return true;
      try { await load(); } catch (error) { if (request === selection) throw error; return false; }
      return request === selection;
    },
    async changeSite(project, site, add) {
      if (state.saving) return false;
      const data = state.data, id = site.properties.site_id;
      const sites = data?.clusters.get(project.id);
      if (!sites || data.missing.has(project.id) || !data.sitesById.has(id)) throw new Error('Project site editing unavailable');
      const member = sites.some(item => item.properties.site_id === id);
      if (member === add || (add && !data.eligible.has(id))) throw new Error('Invalid project site change');
      const next = add ? [...sites,site] : sites.filter(item => item.properties.site_id !== id);
      update({saving:true});
      try {
        await model.save(project.id,next.map(item=>item.properties.site_id));
        const clusters = new Map(data.clusters); clusters.set(project.id,next);
        update({data:{...data,clusters}});
        return true;
      } finally { update({saving:false}); }
    },
  };
}
