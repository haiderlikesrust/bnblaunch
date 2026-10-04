import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { validateCodeJob, sandboxArgs } from './code-job.mjs';
const exec=promisify(execFile),token=process.env.CODE_RUNNER_TOKEN,image=process.env.CODE_SANDBOX_IMAGE,dir='/data';
if(!token||token.length<40||!/^sha256:[0-9a-f]{64}$/.test(image??''))throw Error('Runner token and pinned local image ID are required');
mkdirSync(dir,{recursive:true});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const jobs=new Map();let active=0,ready=false;
const save=record=>{const path=dir+'/'+record.id+'.json';const fd=openSync(path+'.tmp','w',0o600);try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd)}finally{closeSync(fd)}renameSync(path+'.tmp',path);const directory=openSync(dir,'r');try{fsyncSync(directory)}finally{closeSync(directory)}jobs.set(record.id,record);};
for(const file of readdirSync(dir).filter(f=>uuid.test(f.slice(0,-5))&&f.endsWith('.json'))){const r=JSON.parse(readFileSync(dir+'/'+file,'utf8'));if(r.status==='running'){await exec('docker',['rm','-f','shen-code-'+r.id],{timeout:10000}).catch(()=>{});r.status='failed';r.result={error:'Execution interrupted; no automatic rerun.'};save(r);}else jobs.set(r.id,r);}
// A runsc installation and a locally present pinned image are mandatory.
try{const r=JSON.parse((await exec('docker',['info','--format','{{json .Runtimes}}'],{timeout:10000})).stdout);await exec('docker',['image','inspect',image],{timeout:10000});ready=!!r.runsc;}catch{}
async function execute(record,job){
 active++;
 try{
  const name='shen-code-'+record.id,args=sandboxArgs(name,image);
  const result=await new Promise(resolve=>{
   const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let output='',errors='',timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;void exec('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});child.kill('SIGKILL')},25000);
   child.stdout.on('data',b=>{if(output.length<100000)output+=b.toString().slice(0,100000-output.length)});
   child.stderr.on('data',b=>{if(errors.length<1000)errors+=b.toString().slice(0,1000-errors.length)});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(job));
   child.on('error',()=>{clearTimeout(timer);resolve({error:'Sandbox could not start.'})});
   child.on('close',code=>{clearTimeout(timer);if(code!==0||timedOut)return resolve({error:timedOut?'Sandbox time limit reached.':'Sandbox failed to run.'});try{resolve(JSON.parse(output.trim().split('\n').at(-1)))}catch{resolve({error:'Sandbox returned no usable result.'})}});
  });
  const valid=r=>r&&Number.isInteger(r.exitCode)&&typeof r.output==='string'&&r.output.length<=8000&&typeof r.timedOut==='boolean';
  const checked=valid(result.execution)&&(result.tests===null||valid(result.tests))?{execution:result.execution,tests:result.tests}:{error:typeof result.error==='string'?result.error:'Invalid sandbox result.'};
  record.result=checked;record.status=checked.execution?.exitCode===0&&checked.tests?.exitCode===0?'complete':'failed';save(record);
 }catch{record.result={error:'Sandbox unavailable.'};record.status='failed';save(record)}finally{active--}
}
const digest=s=>createHash('sha256').update(s).digest();
createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
  if(!timingSafeEqual(digest(req.headers.authorization??''),digest('Bearer '+token)))return send(401,{error:'Unauthorized'});
  if(req.method==='GET'&&req.url==='/health')return send(ready?200:503,{ready,runtime:'runsc',network:false});
  const id=req.url?.match(/^\/jobs\/([0-9a-f-]{36})$/)?.[1];if(!id||!uuid.test(id))return send(404,{error:'Not found'});
  if(req.method==='GET'){const r=jobs.get(id);return send(r?200:404,r?{id:r.id,status:r.status,result:r.result??null}:{error:'Not found'});}
  if(req.method!=='POST'||!ready)return send(503,{error:'Sandbox unavailable'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000)return send(413,{error:'Too large'});}
  const job=validateCodeJob(JSON.parse(raw)),hash=digest(JSON.stringify(job)).toString('hex'),existing=jobs.get(id);
  if(existing)return send(existing.hash===hash?200:409,existing.hash===hash?{id,status:existing.status,result:existing.result??null}:{error:'Job ID conflict'});
  if(active>=2||jobs.size>=10000)return send(429,{error:'Runner capacity reached'});
  const record={id,hash,status:'running',createdAt:Date.now()};save(record);void execute(record,job);
  return send(202,{id,status:'running',result:null});
 }catch{return send(400,{error:'Invalid job'})}
}).listen(Number(process.env.PORT??8092),'0.0.0.0');
