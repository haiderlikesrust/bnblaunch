import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,copyFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';

for(const dockerfile of ['Dockerfile','services/worker/Dockerfile'])test(`${dockerfile} packages the worker's runtime imports`,()=>{
 const source=readFileSync(dockerfile,'utf8');
 const stage=dockerfile==='Dockerfile'?source.split(/FROM[^\r\n]+ AS worker\r?\n/)[1]?.split(/^FROM /m)[0]:source;
 assert.ok(stage,'Worker build stage exists');
 const root=realpathSync(tmpdir()),directory=mkdtempSync(join(root,'shen-worker-package-'));
 try{
  const copies=[...stage.matchAll(/^COPY(?: --chown=\S+)? (services\/worker\/(?:[\w.-]+|\*\.mjs)) (\S+)\s*$/gm)];
  assert.ok(copies.length,'Worker source COPY is recognized');
  for(const [,pattern,destination] of copies){
   const files=pattern.endsWith('*.mjs')?readdirSync('services/worker').filter(f=>f.endsWith('.mjs')).map(f=>'services/worker/'+f):[pattern];
   for(const file of files){
    const target=resolve(directory,destination.endsWith('/')?destination+file.split('/').at(-1):destination);
    assert.ok(target.startsWith(directory+sep));copyFileSync(file,target);
   }
  }
  // Missing configuration must be the first startup failure, never a missing
  // runtime import. No credentials or network requests are used by this probe.
  const env={...process.env};delete env.SHEN_APP_URL;delete env.NODE_OPTIONS;
  const result=spawnSync(process.execPath,['index.mjs'],{cwd:directory,env,encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);
  assert.match(result.stderr,/SHEN_APP_URL is required/);assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND/);
 }finally{
  const target=realpathSync(directory);assert.ok(target.startsWith(root+sep));rmSync(target,{recursive:true,force:true});
 }
});
