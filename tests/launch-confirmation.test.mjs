import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmLaunch} from '../lib/launch-confirmation.ts';

const args=()=>({coinId:'coin',planId:'plan',hash:'0x123',signal:new AbortController().signal,onPending:()=>{},intervalMs:0,maxAttempts:5});
const coin={id:'coin',tokenAddress:'0x456'};
test('automatically polls pending receipts, tolerates a lost response, and returns confirmed coin',async()=>{
 const original=globalThis.fetch;let calls=0;const messages=[];
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'/api/coins/coin/launch');assert.deepEqual(JSON.parse(options.body),{action:'confirm',planId:'plan',hash:'0x123'});
  calls++;if(calls===1)return Response.json({status:'pending',message:'Waiting for confirmations'},{status:202});
  if(calls===2)throw new TypeError('network');
  return Response.json({coin});
 };
 try{assert.deepEqual(await confirmLaunch({...args(),onPending:m=>messages.push(m)}),coin);assert.equal(calls,3);assert.equal(messages.length,2)}finally{globalThis.fetch=original}
});
test('ownership failures, mismatched transactions and reverted receipts stop polling',async()=>{
 const original=globalThis.fetch;
 try{for(const status of [401,403,400,409]){
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'Verification failed'},{status})};
  await assert.rejects(confirmLaunch(args()),/Verification failed/);assert.equal(calls,1);
 }}finally{globalThis.fetch=original}
});
test('pending and service failure loops are bounded and preserve recovery',async()=>{
 const original=globalThis.fetch;
 try{
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({status:'pending'},{status:202})};
  await assert.rejects(confirmLaunch({...args(),maxAttempts:2}),/taking longer/);assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'Service unavailable'},{status:503})};
  await assert.rejects(confirmLaunch(args()),/Service unavailable/);assert.equal(calls,5);
 }finally{globalThis.fetch=original}
});
test('unmount or account change aborts polling before another request',async()=>{
 const original=globalThis.fetch,controller=new AbortController();let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({status:'pending'},{status:202})};
 try{await assert.rejects(confirmLaunch({...args(),signal:controller.signal,onPending:()=>controller.abort()}),{name:'AbortError'});assert.equal(calls,1)}finally{globalThis.fetch=original}
});
