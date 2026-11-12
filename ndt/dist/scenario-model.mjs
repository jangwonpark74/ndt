export function createScenarioModel(regionId, request=fetch) {
  const url=project=>`/api/regions/${encodeURIComponent(regionId)}/projects/${encodeURIComponent(project)}/radio-scenarios`;
  async function send(project,options={}) {
    const response=await request(url(project),{...options,signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error || 'Scenario service unavailable. Your draft is retained.');
    return result;
  }
  return {load:project=>send(project),save:(project,body)=>send(project,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}
