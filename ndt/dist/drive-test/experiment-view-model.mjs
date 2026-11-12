const scopeKey = item => [item.region_id,item.project_id,item.task_id].join('/');

export class ExperimentWorkspace {
  constructor(api, clock, scope = {}) {
    this.api=api; this.clock=clock; this.scope=scope;
    this.state={catalog:{tasks:[],regions:[]},taskKey:'',routeId:'',caseIds:[],history:[],experiment:null,
      loading:false,submitting:false,error:'',draft:{interval_s:1,rat:'NR',mode:'NLOS',power_a_dbm:46,power_b_dbm:49,transmitter_id:'',experiment_type:'parameter-ab'}};
    this.listeners=new Set(); this.generation=0;
  }
  subscribe(listener) {this.listeners.add(listener);listener(this.state);return()=>this.listeners.delete(listener);}
  emit() {for(const listener of this.listeners)listener(this.state);}
  tasks() {return this.state.catalog.tasks.filter(task=>['region_id','project_id'].every(k=>!this.scope[k]||task[k]===this.scope[k]));}
  task() {return this.tasks().find(task=>scopeKey(task)===this.state.taskKey);}
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
    const preferred=key===this.state.taskKey?this.state.routeId:this.scope.task_id===key.split('/')[2]?this.scope.route_id:'';
    this.state.taskKey=key;const task=this.task();
    this.state.routeId=task?.routes.find(route=>route.id===preferred)?.id||task?.routes[0]?.id||'';this.state.caseIds=task?.speedCases.map(c=>c.id)||[];
    this.state.draft.transmitter_id=task?.transmitters[0]?.id||'';
    this.state.experiment=null;this.state.error='';this.emit();
  }
  edit(fields) {Object.assign(this.state.draft,fields);this.state.error='';this.emit();}
  selectRoute(id) {if(this.task()?.routes.some(route=>route.id===id)){this.state.routeId=id;this.state.error='';this.emit();}}
  selectCases(ids) {this.state.caseIds=(this.task()?.speedCases||[]).filter(item=>ids.includes(item.id)).map(item=>item.id);this.state.error='';this.emit();}
  async submit(requestId) {
    const task=this.task();if(!task||this.state.submitting)return;
    this.state.submitting=true;this.state.error='';this.emit();
    const spec={...this.state.draft,region_id:task.region_id,project_id:task.project_id,task_id:task.task_id,
      route_id:this.state.routeId,case_ids:this.state.caseIds,context_hash:task.context_hash};
    try {await this.open((await this.api.submitExperiment(requestId,spec)).id);}
    catch(error){this.state.error=error.message;}
    finally{this.state.submitting=false;this.emit();}
  }
  async open(id) {
    const generation=++this.generation;this.clock.clear(this.timer);this.state.error='';
    try {
      const experiment=await this.api.loadExperiment(id);
      if(generation!==this.generation)return;
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
