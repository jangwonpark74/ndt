const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {stopFixture}=require('../ui/process-cleanup.cjs');
(async()=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  try {await stopFixture(child);assert.ok(child.exitCode!==null || child.signalCode!==null);}
  finally {if(child.exitCode===null && child.signalCode===null)child.kill();}
  console.log('Owned fixture cleanup completes without process-tree enumeration.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
