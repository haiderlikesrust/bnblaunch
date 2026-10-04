import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {higgsfieldCredentials,generation}=await import('../lib/higgsfield.ts');
test('a complete copied API key is sent unchanged with the Key scheme',async()=>{
 env.HIGGSFIELD_API_KEY='test-single-key-12345678';
 env.HIGGSFIELD_API_KEY_ID='old-id';env.HIGGSFIELD_API_KEY_SECRET='old-secret';
 let auth;await generation('request-123',async(url,init)=>{auth=init.headers.Authorization;return Response.json({status:'queued'});});
 assert.equal(auth,'Key test-single-key-12345678');
 env.HIGGSFIELD_API_KEY='  complete-key:complete-secret  ';assert.equal(higgsfieldCredentials(),'complete-key:complete-secret');
});
test('legacy split credentials work only when the single key is absent',()=>{
 env.HIGGSFIELD_API_KEY='';assert.equal(higgsfieldCredentials(),'old-id:old-secret');
 env.HIGGSFIELD_API_KEY='Key accidental-prefix';assert.equal(higgsfieldCredentials(),null);
 env.HIGGSFIELD_API_KEY='bad\r\nheader';assert.equal(higgsfieldCredentials(),null);
 delete env.HIGGSFIELD_API_KEY;delete env.HIGGSFIELD_API_KEY_SECRET;assert.equal(higgsfieldCredentials(),null);
});
