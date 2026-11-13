export function createEquipmentModel(regionId,request=fetch){
  const url=project=>`/api/regions/${encodeURIComponent(regionId)}/projects/${encodeURIComponent(project)}/equipment-inventory`;
  async function send(project,method='GET',body,revision){
    const response=await request(url(project)+(revision ? `?revision=${revision}` : ''),{method,signal:AbortSignal.timeout(10000),...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    const value=await response.json();if(!response.ok)throw Error(value.error || 'Equipment service unavailable. Your selected file is retained.');return value;
  }
  return {load:(project,revision)=>send(project,'GET',undefined,revision),preview:(project,raw)=>send(project,'POST',{raw}),commit:(project,body)=>send(project,'PUT',body)};
}
