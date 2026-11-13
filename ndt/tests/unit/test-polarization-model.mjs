import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {preparePolarization,prepareReceiver,RECEIVER_MODEL} from '../../dist/polarization-model.mjs';
const orientation=values=>({azimuthDeg:0,tiltDeg:0,rollDeg:0,slantDeg:0,...values});
const receive=(values={},collection='single-linear')=>prepareReceiver({model:RECEIVER_MODEL,collection,orientation:orientation(values)});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
const vector=(a,b)=>a.forEach((v,i)=>near(v,b[i]));
vector(preparePolarization(orientation()).field(0,0),[0,0,-1]);
vector(preparePolarization(orientation({slantDeg:90})).field(0,0),[-1,0,0]);
vector(preparePolarization(orientation({rollDeg:90})).field(0,0),[-1,0,0]);
vector(preparePolarization(orientation({tiltDeg:30})).field(0,-30),[0,-.5,-Math.sqrt(.75)]);
vector(preparePolarization(orientation()).field(0,90),[0,1,0]);
for(const [a,b]of [[0,0],[30,20],[45,-45],[90,90],[89.999,0]]){
 const result=receive({slantDeg:b}).coupling(preparePolarization(orientation({slantDeg:a})),0,0);
 near(result.powerFraction,Math.cos((a+b)*Math.PI/180)**2);
}
const nullResult=receive({slantDeg:90}).coupling(preparePolarization(orientation()),0,0);
assert.equal(nullResult.powerFraction,0);assert.equal(nullResult.mismatchLossDb,null);
for(let i=0;i<150;i++){
 const o=orientation({azimuthDeg:(i*137.507)%360,tiltDeg:(i*31.7)%180-90,rollDeg:(i*77.1)%360-180,slantDeg:(i*11.3)%180-90}),az=(i*23.7)%360,el=(i*43.3)%180-90,tx=preparePolarization(o),field=tx.field(az,el),a=az*Math.PI/180,e=el*Math.PI/180;
 near(field.reduce((n,v)=>n+v*v,0),1);near(field[0]*Math.cos(e)*Math.sin(a)+field[1]*Math.cos(e)*Math.cos(a)+field[2]*Math.sin(e),0);
 assert.equal(receive(o,'dual-orthogonal').coupling(tx,az,el).powerFraction,1);
}
for(const o of [null,{},orientation({phaseDeg:0}),orientation({slantDeg:NaN}),orientation({tiltDeg:true})])assert.throws(()=>preparePolarization(o));
assert.throws(()=>prepareReceiver({model:RECEIVER_MODEL,collection:'coherent-mimo',orientation:orientation()}));
const source=orientation(),fixed=preparePolarization(source);source.rollDeg=90;vector(fixed.field(0,0),[0,0,-1]);
const oracle=spawnSync(process.env.PYTHON||'python',['-X','utf8','-B',fileURLToPath(new URL('../fixtures/polarization-vectors.py',import.meta.url))],{encoding:'utf8'});assert.equal(oracle.status,0,oracle.stderr);
for(const row of JSON.parse(oracle.stdout)){
 const actual=prepareReceiver(row.receiver).coupling(preparePolarization(row.transmitter),row.azimuth,row.elevation);
 near(actual.powerFraction,row.expected.powerFraction);vector(actual.txField,row.expected.txField);actual.rxFields.forEach((v,i)=>vector(v,row.expected.rxFields[i]));
 if(row.expected.mismatchLossDb===null)assert.equal(actual.mismatchLossDb,null);else near(actual.mismatchLossDb,row.expected.mismatchLossDb);
}
console.log('Model-2 LOS polarization: analytic fields, 180 Python parity vectors, rotations, nulls, transversality and dual power conservation passed.');
