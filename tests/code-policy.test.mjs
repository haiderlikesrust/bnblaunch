import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCodeJob,sandboxArgs} from '../shared/code-job.mjs';
const job={goal:'Check a calculation',language:'javascript',files:[{path:'main.mjs',content:'console.log(2+2)'},{path:'test.mjs',content:"import assert from 'node:assert/strict';assert.equal(2+2,4)"}],entrypoint:'main.mjs',testFile:'test.mjs'};
test('workspace only accepts bounded relative source and a separate test file',()=>{
 assert.deepEqual(validateCodeJob(job),job);
 for(const path of ['../escape.py','/root/a.py','C:/x.py','.env','folder/../x.py','a\\b.py','a.sh','a.py\0'])assert.throws(()=>validateCodeJob({...job,files:[...job.files,{path,content:''}]}));
 assert.throws(()=>validateCodeJob({...job,testFile:'main.mjs'}));
 assert.throws(()=>validateCodeJob({...job,command:'curl attacker.example'}));
 assert.throws(()=>validateCodeJob({...job,files:[...job.files,job.files[0]]}));
 assert.throws(()=>validateCodeJob({...job,files:job.files.map(f=>({...f,content:'界'.repeat(10000)}))}));
});
test('sandbox flags mandate gVisor, bounded resources, no network and no host mounts',()=>{
 const args=sandboxArgs('shen-code-11111111-1111-1111-1111-111111111111','sha256:'+'a'.repeat(64));
 for(const flag of ['--runtime=runsc','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=256m','--pids-limit=32','--cpus=0.5','--user=1000:1000','--pull=never'])assert.ok(args.includes(flag));
 assert.equal(args.some(v=>v.includes('docker.sock')||v==='--privileged'||v==='--volume'||v==='--mount'),false);
 assert.throws(()=>sandboxArgs('other','sha256:'+'a'.repeat(64)));
 assert.throws(()=>sandboxArgs('shen-code-11111111-1111-1111-1111-111111111111','mutable:latest'));
});
