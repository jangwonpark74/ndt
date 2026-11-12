import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {umaPathLoss} from '../../dist/radio-model.mjs';

const inputs=[];
for(const distance of [10,100,1000,5000])for(const frequency of [500,720,3500,100000])for(const mode of ['LOS','NLOS'])inputs.push([distance,frequency,mode]);
inputs.push([9,3500,'LOS'],[5001,3500,'NLOS'],[100,499,'LOS'],[100,3500,'invalid']);
const python="import json,sys;from backend.dm.simulation import path_loss;print(json.dumps([path_loss(*x) for x in json.load(sys.stdin)]))";
const values=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-B','-c',python],{cwd:fileURLToPath(new URL('../../',import.meta.url)),input:JSON.stringify(inputs),encoding:'utf8'}));
inputs.forEach((args,i)=>{const expected=umaPathLoss(...args);if(expected===null)assert.equal(values[i],null);else assert.ok(Math.abs(expected-values[i])<1e-10,`UMa parity ${args}`);});
console.log(`Python and JavaScript UMa parity passed for ${inputs.length} supported and boundary cases.`);
