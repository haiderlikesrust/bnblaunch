import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCadence} from '../lib/activity-cadence.ts';
const now=Date.now();
const flow=wei=>({status:'observed',observedAt:now,windows:[{requestedMinutes:60,observedMinutes:60,averageWeiPerHour:wei}]});
const market=(recent=100,prior=100)=>({stale:false,observedAt:now,lastCandles:[{time:Math.floor((now-2400000)/1000),volume:prior},{time:Math.floor((now-600000)/1000),volume:recent}]});
const pace=(wei,m=market(),credit=10000000)=>activityCadence(flow(wei),m,credit,10000,now);
test('higher confirmed fee flow increases publishing and research cadence; cooling slows both',()=>{
 const quiet=pace('0'),normal=pace('1000000000000000'),busy=pace('100000000000000000');
 assert.ok(quiet.publicationMinutes>normal.publicationMinutes);assert.ok(normal.publicationMinutes>busy.publicationMinutes);
 assert.equal(busy.planningMinutes,1);assert.equal(quiet.planningMinutes,5);
 assert.ok(pace('1000000000000000',market(200)).publicationMinutes<pace('1000000000000000',market(50)).publicationMinutes);
});
test('volume alone cannot become spendable income; stale signals and low credit cannot accelerate spending',()=>{
 assert.equal(pace('0',market(1000000)).publicationMinutes,60);
 assert.equal(pace('100000000000000000',market(),100).publicationMinutes,60);
 assert.equal(pace('1000000000000000',{...market(100000),stale:true}).publicationMinutes,pace('1000000000000000').publicationMinutes);
 const unknown=activityCadence({...flow('100000000000000000'),observedAt:now-600000},market(),10000000,10000,now);
 assert.equal(unknown.feeBnbPerHour,null);assert.equal(unknown.publicationMinutes,20);
});
