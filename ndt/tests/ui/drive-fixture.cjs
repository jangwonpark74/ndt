const {test:base,expect}=require('@playwright/test');
const {spawn}=require('node:child_process');
const {mkdtemp,rm}=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const readline=require('node:readline');

const test=base.extend({driveOrigin:async({},use)=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'ndt-drive-'));
  const child=spawn(process.env.PYTHON||'python3',['-B','tests/serve-drive-fixture.py','--port','0','--db',path.join(temp,'planning.sqlite3'),'--dm-db',path.join(temp,'tests.sqlite3')],
    {cwd:path.join(__dirname,'../..'),stdio:['ignore','pipe','ignore']});
  try{
    const url=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(new Error(`NDT fixture exited ${code}`)));const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const match=line.match(/http:\/\/[^ ]+/);if(match){lines.close();resolve(match[0]);}});});
    await use(url);
  }finally{
    if(child.exitCode===null&&child.signalCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}
    await rm(temp,{recursive:true,force:true});
  }
}});
const task={id:'MERGE-TEST',name:'Virtual drive acceptance',speedCases:[20,40,60].map(speed=>({id:`C${speed}`,name:`${speed} km/h`,speedKmh:speed})),
  routes:[{id:'r',name:'North York route',coordinates:[[-79.412,43.761],[-79.411,43.761],[-79.410,43.761]],roadFit:'fitted'}]};
const endpoint='/api/regions/toronto/projects/northyork/tasks';
async function installTask(request,origin,value=task){const response=await request.put(origin+endpoint,{data:[value]});expect(response.ok()).toBe(true);}
async function maps(page){
  await page.route('https://tiles.openfreemap.org/styles/liberty',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#d5e1dc'}}]}}));
  await page.route('https://tiles.mapterhorn.com/**',route=>route.abort());
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.route('**/api/road-route',route=>route.fulfill({json:{coordinates:route.request().postDataJSON()}}));
}
module.exports={test,expect,task,endpoint,installTask,maps};
