// Runs INSIDE the disposable gVisor container. No credentials are passed here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { validateCodeJob } from './code-job.mjs';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('Input too large');}
const job=validateCodeJob(JSON.parse(input));
for(const file of job.files){mkdirSync(dirname('/work/'+file.path),{recursive:true});writeFileSync('/work/'+file.path,file.content,{flag:'wx'});}
async function run(file){
 return new Promise(resolve=>{
  const child=spawn(job.language==='python'?'python3':'node',[...(job.language==='python'?['-E','-s','-B']:[]),file],{cwd:'/work',env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/work',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe'],detached:true});
  let output='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL')}catch{}},9000);
  const add=b=>{if(output.length<8000)output+=b.toString().slice(0,8000-output.length)};child.stdout.on('data',add);child.stderr.on('data',add);
  child.on('error',()=>{clearTimeout(timer);resolve({exitCode:1,timedOut:false,output:'Could not start interpreter.'})});
  child.on('close',code=>{clearTimeout(timer);try{process.kill(-child.pid,'SIGKILL')}catch{}resolve({exitCode:code??1,timedOut,output})});
 });
}
const execution=await run(job.entrypoint),tests=execution.exitCode===0?await run(job.testFile):null;
console.log(JSON.stringify({execution,tests}));
