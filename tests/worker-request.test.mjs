import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceRequest,failureCode} from '../services/worker/request.mjs';

test('worker failures expose HTTP/transport codes without provider secrets',async()=>{
 const original=globalThis.fetch;
 try{
  for(const [fetcher,code] of [
   [async()=>new Response('secret-provider-body',{status:503}),'HTTP_503'],
   [async()=>{throw new Error('https://provider.test/secret-key')},'NETWORK_ERROR'],
   [async()=>{throw new DOMException('secret','TimeoutError')},'TIMEOUT'],
   [async()=>new Response('secret-invalid-json'),'INVALID_JSON'],
  ]){
   globalThis.fetch=fetcher;
   await assert.rejects(serviceRequest(new URL('https://web.test'),'/api/internal/worker','secret-token',{action:'tick'}),error=>{
    assert.equal(failureCode(error),code);assert.ok(!error.message.includes('secret'));return true;
   });
  }
  assert.equal(failureCode(new Error('secret')),'UNEXPECTED_ERROR');
  globalThis.fetch=async(_url,init)=>{assert.equal(init.headers.Authorization,'Bearer test');assert.equal(init.redirect,'error');assert.equal(init.method,'POST');return Response.json({processed:true})};
  assert.deepEqual(await serviceRequest(new URL('https://web.test'),'/api/internal/worker','test',{action:'tick'}),{processed:true});
 }finally{globalThis.fetch=original;}
});
