export function createInventoryClusterModel(region,request=fetch){
 const url=project=>`/api/regions/${encodeURIComponent(region)}/projects/${encodeURIComponent(project)}/inventory-clusters`;
 async function send(project,options={}){
  const response=await request(url(project),{...options,signal:AbortSignal.timeout(10000)}),value=await response.json();
  if(!response.ok)throw Error(value.error || 'Inventory groups unavailable. Your draft is retained.');return value;
 }
 return {load:project=>send(project),save:(project,body)=>send(project,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}
