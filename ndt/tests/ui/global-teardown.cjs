const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async()=>{
  const file=path.join(process.env.NDT_UI_FIXTURE_DIR,'server-process.json');
  let identity;
  try{identity=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(identity.runId!==process.env.NDT_UI_RUN_ID || !Number.isInteger(identity.pid) || identity.pid<=0)throw Error('Unexpected test-server process identity');
  let response;
  try{response=await fetch(`http://127.0.0.1:${process.env.NDT_UI_PORT || 5189}/__ndt_test_identity`,{signal:AbortSignal.timeout(3000)});}
  catch(error){if(error.cause?.code==='ECONNREFUSED')return;throw error;}
  const live=await response.json();
  if(live.pid!==identity.pid || live.runId!==identity.runId)throw Error('Test-server runtime identity does not match; process left untouched');
  try{process.kill(identity.pid);}catch(error){if(error.code!=='ESRCH')throw error;}
};
