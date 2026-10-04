// Shared validation at both trust boundaries: web planner and isolated runner.
export function validateCodeJob(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['goal','language','files','entrypoint','testFile'].includes(k)))throw Error('Invalid code job');
 const {goal,language,files,entrypoint,testFile}=value;
 if(typeof goal!=='string'||goal.length<3||goal.length>240||!['javascript','python'].includes(language)||!Array.isArray(files)||files.length<1||files.length>12)throw Error('Invalid code job');
 const names=new Set();let bytes=0;
 for(const file of files){
  if(!file||Object.keys(file).some(k=>!['path','content'].includes(k))||typeof file.path!=='string'||!validCodePath(file.path)||typeof file.content!=='string'||file.content.length>12000||names.has(file.path))throw Error('Invalid workspace file');
  names.add(file.path);bytes+=new TextEncoder().encode(file.content).length;
 }
 const extension=language==='python'?/\.py$/:/\.(?:js|mjs|cjs)$/;
 if(bytes>24000||typeof entrypoint!=='string'||typeof testFile!=='string'||entrypoint===testFile||!names.has(entrypoint)||!names.has(testFile)||!extension.test(entrypoint)||!extension.test(testFile))throw Error('Include separate source and test files within 24 KB');
 return {goal,language,files,entrypoint,testFile};
}
export function validCodePath(path){return typeof path==='string'&&path.length<=120&&/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:py|js|mjs|cjs|json|txt|md|csv|html|css)$/.test(path);}
export function sandboxArgs(name,image){
 if(!/^shen-code-[0-9a-f-]{36}$/.test(name)||!/^sha256:[0-9a-f]{64}$/.test(image))throw Error('Pinned sandbox image required');
 return ['run','--rm','--pull=never','--name',name,'--runtime=runsc','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=256m','--memory-swap=256m','--cpus=0.5','--ulimit','nofile=128:128','--user=1000:1000','--tmpfs','/work:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000','--log-driver=none','--env','HOME=/work','--workdir=/work','-i',image];
}
