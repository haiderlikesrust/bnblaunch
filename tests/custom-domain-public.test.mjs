import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {publicDomain}=await import('../lib/custom-domains.ts');
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE coins(id text,token_address text); CREATE TABLE coin_domains(coin_id text,domain text,state text,expires_at integer,last_error text); CREATE TABLE domain_orders(coin_id text,domain text,status text,kind text,created_at integer);
 INSERT INTO coins VALUES('live','0x1'),('draft',NULL);`);
 function prepare(query,values=[]){return {bind(...params){return prepare(query,params)},async first(){return sql.prepare(query).get(...values)??null;}};}
 env.DB={prepare};return sql;
}
test('domain funding progress is public only for launched coins and never claims registration',async()=>{
 const sql=fixture();try{
  sql.exec("INSERT INTO domain_orders VALUES('live','new.xyz','funding','register',1),('draft','private.xyz','funding','register',1)");
  assert.equal(await publicDomain('draft'),null);const value=await publicDomain('live');
  assert.equal(value.domain,'new.xyz');assert.equal(value.progress,'funding');assert.equal(value.registered,false);assert.equal(value.state,'provisioning');assert.equal(value.expiresAt,null);
 }finally{sql.close();}
});
test('a live domain remains available during renewal while prior failed orders do not become current progress',async()=>{
 const sql=fixture();try{
  sql.prepare('INSERT INTO coin_domains VALUES(?,?,?,?,?)').run('live','new.xyz','live',Date.now()+86400000,null);
  sql.exec("INSERT INTO domain_orders VALUES('live','old.xyz','failed','register',1),('live','new.xyz','live','register',2)");
  assert.equal((await publicDomain('live')).progress,null);
  sql.exec("INSERT INTO domain_orders VALUES('live','new.xyz','funding','renew',3)");
  const value=await publicDomain('live');assert.equal(value.state,'live');assert.equal(value.registered,true);assert.equal(value.progress,'funding');
 }finally{sql.close();}
});
test('expired domains are marked unavailable and private provider errors are never exposed',async()=>{
 const sql=fixture();try{
  sql.prepare('INSERT INTO coin_domains VALUES(?,?,?,?,?)').run('live','new.xyz','live',Date.now()-1,'upstream private credit and response details');
  const value=await publicDomain('live');assert.equal(value.state,'degraded');assert.match(value.error,/renewal is pending/);assert.ok(!JSON.stringify(value).includes('upstream private'));
 }finally{sql.close();}
});
