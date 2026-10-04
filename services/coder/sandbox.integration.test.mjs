// Opt-in real sandbox test. Run only against the dedicated execution Docker host.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sandboxArgs} from '../../shared/code-job.mjs';
const image=process.env.CODE_SANDBOX_IMAGE;
async function run(job){return new Promise((resolve,reject)=>{const child=spawn('docker',sandboxArgs('shen-code-'+randomUUID(),image)),parts=[];child.stdout.on('data',b=>parts.push(b));child.stderr.on('data',()=>{});child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(Error('Sandbox failed: '+code));try{resolve(JSON.parse(Buffer.concat(parts).toString().trim().split('\n').at(-1)))}catch(e){reject(e)}});child.stdin.end(JSON.stringify(job));});}
test('gVisor executes source/tests, excludes secrets and blocks network',{skip:!image,timeout:40000},async()=>{
 const job={goal:'Isolation integration test',language:'javascript',entrypoint:'main.mjs',testFile:'test.mjs',files:[
 {path:'main.mjs',content:"import fs from 'node:fs';fs.writeFileSync('only-this-job.txt','present');console.log('ran');"},
 {path:'test.mjs',content:"import assert from 'node:assert/strict';import fs from 'node:fs';assert.equal(process.env.CODE_RUNNER_TOKEN,undefined);assert.equal(process.env.SIGNER_MASTER_KEY,undefined);assert.equal(fs.existsSync('/var/run/docker.sock'),false);await assert.rejects(fetch('https://example.com',{signal:AbortSignal.timeout(1000)}));assert.throws(()=>fs.writeFileSync('/runner/escape.txt','x'));console.log('isolation checked');"}]};
 const first=await run(job);assert.equal(first.execution.exitCode,0);assert.equal(first.tests.exitCode,0);assert.match(first.tests.output,/isolation checked/);
 job.files[0].content="import fs from 'node:fs';if(fs.existsSync('only-this-job.txt'))throw Error('cross-job leak');";
 const second=await run(job);assert.equal(second.execution.exitCode,0);
});
test('Python imports its own workspace and tests execute',{skip:!image,timeout:30000},async()=>{
 const r=await run({goal:'Python tests',language:'python',entrypoint:'main.py',testFile:'test.py',files:[{path:'main.py',content:'def add(a,b): return a+b\nprint(add(2,3))'},{path:'test.py',content:'from main import add\nassert add(2,3)==5'}]});assert.equal(r.execution.exitCode,0);assert.equal(r.tests.exitCode,0);
});
test('unbounded code is stopped',{skip:!image,timeout:30000},async()=>{
 const r=await run({goal:'Enforce time limit',language:'javascript',entrypoint:'main.mjs',testFile:'test.mjs',files:[{path:'main.mjs',content:'while(true){}'},{path:'test.mjs',content:'console.log("not reached")'}]});assert.equal(r.execution.timedOut,true);assert.notEqual(r.execution.exitCode,0);assert.equal(r.tests,null);
});
