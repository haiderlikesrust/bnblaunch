import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { stringToHex } from 'viem';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={APP_ORIGIN:'https://shen.now'};
const {challenge,verifyLogin}=await import('../lib/auth.ts');
function fixture(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,values=[]){return {bind(...next){return prepare(query,next)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}}},async first(){return sql.prepare(query).get(...values)??null},async all(){return {results:sql.prepare(query).all(...values)}}}}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 return sql;
}
test('spamming challenges for a wallet cannot lock its owner out of signing in',async()=>{
 const sql=fixture(),owner=privateKeyToAccount('0x'+'34'.repeat(32));
 for(let i=0;i<12;i++)await challenge(owner.address.toLowerCase(),'https://shen.now');
 assert.ok(sql.prepare("SELECT COUNT(*) AS n FROM wallet_challenges WHERE consumed=0").get().n<=4,'old challenges are evicted, not refused');
 const fresh=await challenge(owner.address.toLowerCase(),'https://shen.now');
 assert.match(fresh.message,new RegExp(owner.address),'the message carries the EIP-55 checksummed address');
 const login=await verifyLogin(fresh.id,await owner.signMessage({message:fresh.message}));
 assert.equal(login.wallet,owner.address.toLowerCase());
 await assert.rejects(verifyLogin(fresh.id,await owner.signMessage({message:fresh.message})),{status:401},'a challenge is single-use');
 sql.close();
});
test('expired challenges are purged, and invalid input reports a client error',async()=>{
 const sql=fixture();
 sql.prepare("INSERT INTO wallet_challenges(id,wallet,message,expires_at,consumed) VALUES('old','0xabc','m',?,0)").run(Date.now()-120000);
 await challenge('0x'+'12'.repeat(20),'https://shen.now');
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM wallet_challenges WHERE id='old'").get().n,0);
 await assert.rejects(challenge('not-a-wallet','https://shen.now'),{status:400});
 const other=privateKeyToAccount('0x'+'56'.repeat(32)),c=await challenge('0x'+'12'.repeat(20),'https://shen.now');
 await assert.rejects(verifyLogin(c.id,await other.signMessage({message:c.message})),{status:401},'a signature from another wallet is rejected');
 assert.ok(stringToHex);sql.close();
});
