import {validateTasks, importRoutes, routeFeatures, taskDriveMetrics, taskSpeedCases, parseSpeedCases} from './task-data.mjs';

export function createTaskViewModel(model) {
  const projects = new Map(), listeners = new Set();
  let projectId = null;
  let fitting = null;
  const empty = () => ({tasks:[],draft:null,originalId:null,dirty:false,loading:false,saving:false,error:'',loaded:false,drawing:null,routing:null,speedText:'',speedError:''});
  const current = () => projects.get(projectId) || empty();
  const emit = () => { for (const listener of listeners) listener({...current(),projectId}); };
  const update = changes => { Object.assign(current(),changes); emit(); };
  function changeDraft(draft) { update({draft,dirty:true,error:''}); }
  function cancelFit() {
    fitting?.abort(); fitting = null;
    update({routing:null});
  }
  async function fitRoutes(routes) {
    const target = current(), controller = new AbortController(); fitting = controller;
    for (let index=0;index<routes.length;index++) {
      const route = routes[index]; update({routing:{index:index+1,total:routes.length,name:route.name}});
      let next;
      try {
        next = await model.fit(route,controller.signal);
        const draft = {...target.draft,routes:target.draft.routes.map(item=>item.id === route.id ? next : item)};
        validateTasks([...target.tasks.filter(task=>task.id !== target.originalId),{...draft,name:draft.name || 'Draft'}]);
      } catch (error) {
        next = {...route,roadFit:route.roadFit === 'fitted' ? 'fitted' : 'unmatched',fitMessage:route.roadFit === 'fitted' ? 'Refit failed; the previous fitted path is kept.' : 'Not fitted: '+(error.name === 'TimeoutError' ? 'The road service timed out. Use Fit to roads to retry.' : error.message).slice(0,220)};
      }
      if (fitting !== controller || controller.signal.aborted) return;
      changeDraft({...target.draft,routes:target.draft.routes.map(item=>item.id === route.id ? next : item)});
    }
    if (fitting === controller) {fitting=null;update({routing:null});}
  }
  return {
    getState: () => ({...current(),projectId}),
    driveMetrics(task) {
      if (task) return task.driveMetrics?.speedCases ? task.driveMetrics : taskDriveMetrics(task);
      const {draft,speedError}=current();
      return taskDriveMetrics(speedError ? {...draft,speedCases:[],driveSpeedKmh:null} : draft);
    },
    subscribe(listener) { listeners.add(listener); listener({...current(),projectId}); return () => listeners.delete(listener); },
    async selectProject(id) {
      cancelFit();
      projectId = id;
      if (!projects.has(id)) projects.set(id,empty());
      update({drawing:null});
      if (current().loaded || current().loading) return;
      const target = current();
      update({loading:true,error:''});
      try {
        const tasks = await model.load(id);
        Object.assign(target,{tasks,loaded:true,loading:false});
      } catch (error) { Object.assign(target,{error:error.message,loading:false}); }
      if (projectId === id) emit();
    },
    newTask() {
      if (!current().loaded || current().saving || current().dirty || current().routing) return;
      let index = 1; while (current().tasks.some(task=>task.id === `TASK-${String(index).padStart(3,'0')}`)) index++;
      update({draft:{id:`TASK-${String(index).padStart(3,'0')}`,name:'',driveSpeedKmh:null,speedCases:[],routes:[]},originalId:null,dirty:true,drawing:null,error:'',speedText:'',speedError:''});
    },
    selectTask(id) {
      if (current().saving || current().dirty || current().routing) return;
      const task = current().tasks.find(item=>item.id === id);
      if (!task) return;
      update({draft:structuredClone(task),originalId:id,dirty:false,drawing:null,error:'',speedText:taskSpeedCases(task).map(item=>item.speedKmh).join(', '),speedError:''});
    },
    edit(fields) {
      if (!current().draft || current().saving || current().routing) return;
      if ('driveSpeedKmh' in fields && !('speedCases' in fields)) {
        const speed=fields.driveSpeedKmh,existing=taskSpeedCases(current().draft);
        const cases=speed==null?[]:[{id:existing[0]?.id || 'CASE-001',name:`${speed} km/h`,speedKmh:speed},...existing.slice(1)];
        update({speedText:cases.map(item=>item.speedKmh).join(', '),speedError:''});fields={...fields,speedCases:cases};
      }
      changeDraft({...current().draft,...fields});
    },
    editSpeeds(text) {
      if (!current().draft || current().saving || current().routing) return;
      try {
        const cases=parseSpeedCases(text,taskSpeedCases(current().draft));
        update({speedText:text,speedError:''});changeDraft({...current().draft,speedCases:cases,driveSpeedKmh:cases[0]?.speedKmh ?? null});
      } catch(error) {update({speedText:text,speedError:error.message,dirty:true});}
    },
    discard() {
      if (current().saving) return;
      cancelFit();
      const task = current().tasks.find(item=>item.id === current().originalId);
      update({draft:task ? structuredClone(task) : null,dirty:false,drawing:null,error:'',speedText:taskSpeedCases(task).map(item=>item.speedKmh).join(', '),speedError:''});
    },
    beginDraw(name) {
      if (!current().draft || current().saving || current().routing) return;
      update({drawing:{name:name.trim() || `Route ${current().draft.routes.length+1}`,coordinates:[]},error:''});
    },
    addPoint(point) {
      if (!current().drawing) return false;
      update({drawing:{...current().drawing,coordinates:[...current().drawing.coordinates,point]}}); return true;
    },
    undoPoint() { if (current().drawing) update({drawing:{...current().drawing,coordinates:current().drawing.coordinates.slice(0,-1)}}); },
    cancelDraw() { update({drawing:null}); },
    async finishDraw() {
      const {draft,drawing} = current();
      if (!drawing) return;
      try {
        let index = 1; while (draft.routes.some(route=>route.id === `route-${index}`)) index++;
        const next = {...draft,routes:[...draft.routes,{...drawing,id:`route-${index}`}]};
        validateTasks([{...next,name:next.name || 'Draft'}]);
        update({drawing:null}); changeDraft(next);
        await fitRoutes([next.routes.at(-1)]);
      } catch (error) { update({error:error.message}); }
    },
    async import(geojson) {
      if (!current().draft || current().saving || current().routing || current().drawing) return;
      try {
        const routes = importRoutes(geojson,current().draft.routes);
        changeDraft({...current().draft,routes:[...current().draft.routes,...routes]});
        await fitRoutes(routes);
      }
      catch (error) { update({error:error.message}); }
    },
    fitRoute(id) {
      if (!current().draft || current().saving || current().routing || current().drawing) return;
      const route = current().draft.routes.find(item=>item.id === id);
      if (route) return fitRoutes([route]);
    },
    cancelFit,
    removeRoute(id) { if (!current().routing) changeDraft({...current().draft,routes:current().draft.routes.filter(route=>route.id !== id)}); },
    reportError(message) { update({error:message}); },
    async save(remove = false) {
      const target = current(), id = projectId;
      if (!target.loaded || target.saving || !target.draft || target.drawing || target.routing) return false;
      if (target.speedError && !remove) {update({error:target.speedError});return false;}
      try {
        const tasks = target.tasks.filter(task=>task.id !== target.originalId);
        if (!remove) tasks.push({...target.draft,name:target.draft.name.trim()});
        validateTasks(tasks);
        update({saving:true,error:''});
        const accepted = await model.save(id,tasks);
        const saved = Array.isArray(accepted) ? accepted : tasks;
        const selected = remove ? null : saved.find(task=>task.id === target.draft.id);
        Object.assign(target,{tasks:saved,draft:selected ? structuredClone(selected) : null,originalId:selected?.id || null,dirty:false,saving:false,speedText:taskSpeedCases(selected).map(item=>item.speedKmh).join(', '),speedError:''});
        emit(); return true;
      } catch (error) { Object.assign(target,{saving:false,error:error.message}); emit(); return false; }
    },
    features() {
      const {draft,drawing} = current();
      return routeFeatures([...(draft?.routes || []),...(drawing ? [drawing] : [])]);
    },
  };
}
