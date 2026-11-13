const scopeKey = item => [item.region_id,item.project_id,item.task_id].join('/');

export class ExperimentWorkspace {
  constructor(api, clock, scope = {}) {
    this.api=api; this.clock=clock; this.scope=scope;
    this.state={catalog:{tasks:[],regions:[]},taskKey:'',routeId:'',caseIds:[],history:[],experiment:null,
      loading:false,submitting:false,error:'',draft:{interval_s:1,rat:'NR',mode:'NLOS',power_a_dbm:46,power_b_dbm:49,transmitter_id:'',experiment_type:'parameter-ab',scenario_id:''}};
    this.listeners=new Set(); this.generation=0;
  }
  subscribe(listener) {this.listeners.add(listener);listener(this.state);return()=>this.listeners.delete(listener);}
  emit() {for(const listener of this.listeners)listener(this.state);}
  tasks() {return this.state.catalog.tasks.filter(task=>['region_id','project_id'].every(k=>!this.scope[k]||task[k]===this.scope[k]));}
  task() {return this.tasks().find(task=>scopeKey(task)===this.state.taskKey);}
  projectContext(){const task=this.task(),id=task?.radio_context_id || (task?`${task.region_id}/${task.project_id}`:'');return this.state.catalog.projects?.find(project=>project.id===id);}
  scenario(){return this.projectContext()?.scenarios.find(s=>s.id===this.state.draft.scenario_id);}
  scenarioIssue(){if(!this.state.draft.scenario_id)return '';const selected=this.scenario();return !selected?'Applied scenario is unavailable. Refresh planning inputs.':!selected.qualified?selected.issue || 'Carrier checks are required for this scenario.':'';}
  transmitters(){return this.state.draft.scenario_id?(this.scenario()?.transmitters || []).filter(t=>t.rat===this.state.draft.rat):this.task()?.transmitters || [];}
  syncTransmitter(resetPower=false){
    const candidates=this.transmitters(),current=candidates.find(t=>t.id===this.state.draft.transmitter_id) || candidates[0];
    this.state.draft.transmitter_id=current?.id || '';
    if(resetPower && this.state.draft.scenario_id && Number.isFinite(current?.eirp_dbm))this.state.draft.power_b_dbm=current.eirp_dbm;
  }
  selectScenario(id){
    this.state.draft.scenario_id=id;const selected=this.scenario();
    if(id && (!Number.isFinite(this.state.draft.power_a_dbm) || this.state.draft.power_a_dbm<0 || this.state.draft.power_a_dbm>90))this.state.draft.power_a_dbm=46;
    if(selected?.transmitters.length && !selected.transmitters.some(t=>t.rat===this.state.draft.rat))this.state.draft.rat=selected.transmitters[0].rat;
    if(!id)this.state.draft.power_b_dbm=49;
    this.syncTransmitter(true);this.state.error='';this.emit();
  }
  specification(){const task=this.task();return task?{...this.state.draft,region_id:task.region_id,project_id:task.project_id,task_id:task.task_id,route_id:this.state.routeId,case_ids:this.state.caseIds,context_hash:task.context_hash}:null;}
  setupDiffers(){
    const saved=this.state.experiment?.spec,current=this.specification();if(!saved || !current)return false;
    const normalize=(item,key)=>key==='scenario_id'?item[key] || '':key==='case_ids'?[...(item[key] || [])].sort():item[key];
    return [...new Set([...Object.keys(saved),...Object.keys(current)])].some(key=>JSON.stringify(normalize(saved,key))!==JSON.stringify(normalize(current,key)));
  }
  preview() {
    const task=this.task(),cases=task?.speedCases.filter(c=>this.state.caseIds.includes(c.id))||[];
    const distanceKm=task?.routeMetrics?.find(r=>r.id===this.state.routeId)?.distanceKm||0;
    const variants=this.state.draft.experiment_type==='parameter-ab'?2:1;
    return {distanceKm,runCount:cases.length*variants,observationCount:cases.reduce((sum,c)=>sum+Math.ceil(distanceKm*1000/(c.speedKmh/3.6)/this.state.draft.interval_s)+1,0)*variants};
  }
  async load(catalog) {
    this.state.loading=true;this.state.error='';this.emit();
    try {
      [this.state.catalog,this.state.history]=await Promise.all([catalog?Promise.resolve(catalog):this.api.loadCatalog(),this.api.loadExperiments()]);
      const desired=this.state.taskKey||scopeKey(this.scope),task=this.tasks().find(t=>scopeKey(t)===desired);
      this.selectTask(task?desired:'');
    }catch(error){this.state.error=error.message;}
    finally{this.state.loading=false;this.emit();}
  }
  selectTask(key) {
    ++this.generation;this.clock.clear(this.timer);
    const scenarioId=key===this.state.taskKey?this.state.draft.scenario_id:'';
    const preferred=key===this.state.taskKey?this.state.routeId:this.scope.task_id===key.split('/')[2]?this.scope.route_id:'';
    this.state.taskKey=key;const task=this.task();
    this.state.routeId=task?.routes.find(route=>route.id===preferred)?.id||task?.routes[0]?.id||'';this.state.caseIds=task?.speedCases.map(c=>c.id)||[];
    this.state.draft.scenario_id=scenarioId;this.syncTransmitter();
    this.state.experiment=null;this.state.error='';this.emit();
  }
  edit(fields) {Object.assign(this.state.draft,fields);if('rat' in fields || 'transmitter_id' in fields)this.syncTransmitter(true);this.state.error='';this.emit();}
  selectRoute(id) {if(this.task()?.routes.some(route=>route.id===id)){this.state.routeId=id;this.state.error='';this.emit();}}
  selectCases(ids) {this.state.caseIds=(this.task()?.speedCases||[]).filter(item=>ids.includes(item.id)).map(item=>item.id);this.state.error='';this.emit();}
  async submit(requestId) {
    const task=this.task();if(!task||this.state.submitting)return;
    const issue=this.scenarioIssue();if(issue){this.state.error=issue;this.emit();return;}
    if(this.state.draft.scenario_id && !this.transmitters().length){this.state.error=`No ${this.state.draft.rat} transmitters are assigned in this scenario.`;this.emit();return;}
    this.state.submitting=true;this.state.error='';this.emit();
    const spec=this.specification(),generation=this.generation;
    try {
      const created=await this.api.submitExperiment(requestId,spec);
      this.state.history=[{id:created.id,status:created.status || 'queued',created:created.created,progress:created.progress || 0,error:created.error || '',spec:created.spec || spec},...this.state.history.filter(item=>item.id!==created.id)];
      if(generation===this.generation)await this.open(created.id);
    }
    catch(error){if(generation===this.generation)this.state.error=error.message;}
    finally{this.state.submitting=false;this.emit();}
  }
  async open(id) {
    const generation=++this.generation;this.clock.clear(this.timer);this.state.error='';
    try {
      const experiment=await this.api.loadExperiment(id);
      if(generation!==this.generation)return;
      this.state.history=this.state.history.map(item=>item.id===experiment.id?{...item,status:experiment.status,progress:experiment.progress,error:experiment.error || ''}:item);
      this.state.experiment=experiment;this.emit();
      if(['queued','running'].includes(experiment.status))this.timer=this.clock.set(()=>this.open(id),600);
    }catch(error){if(generation===this.generation){this.state.error=error.message;this.emit();}}
  }
  async cancel() {
    if(!this.state.experiment)return;
    try {await this.api.cancelExperiment(this.state.experiment.id);await this.open(this.state.experiment.id);}
    catch(error){this.state.error=error.message;this.emit();}
  }
  history() {const scope=this.task()||this.scope;return this.state.history.filter(e=>['region_id','project_id','task_id'].every(k=>!scope[k]||e.spec[k]===scope[k]));}
  dispose() {++this.generation;this.clock.clear(this.timer);}
}
