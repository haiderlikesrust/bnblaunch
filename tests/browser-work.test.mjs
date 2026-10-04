import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicAddress,publicUrl,publicFetch } from '../services/browser/public-fetch.mjs';
import { register } from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
const {marketSignals}=await import('../lib/agent-signals.ts');
test('browser seccomp permits namespace sandbox setup with all container capabilities dropped',()=>{
 const profile=JSON.parse(readFileSync(new URL('../services/browser/seccomp.json',import.meta.url),'utf8'));
 assert.equal(profile.defaultAction,'SCMP_ACT_ERRNO');
 // Docker evaluates capability conditions before Chromium creates its own
 // user namespace. A CAP_SYS_CHROOT include silently removes this rule.
 const allowed=new Set(profile.syscalls.filter(rule=>rule.action==='SCMP_ACT_ALLOW'&&!rule.includes?.caps?.length&&!rule.includes?.arches?.length&&!rule.args?.length).flatMap(rule=>rule.names));
 for(const syscall of ['clone','unshare','setns','chroot'])assert.ok(allowed.has(syscall),syscall+' must not depend on container capabilities');
 for(const syscall of ['mount','bpf','init_module'])assert.equal(allowed.has(syscall),false,syscall+' must remain restricted');
});
test('browser refuses private, local, credential-bearing and non-web destinations',async()=>{
 for(const ip of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.2.3','192.168.1.1','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);
 for(const url of ['file:///etc/passwd','http://localhost/','http://2130706433/','http://0x7f000001/','http://user:pass@public.com/','http://public.com:8080/','https://thing.internal/'])assert.throws(()=>publicUrl(url),url);
 assert.equal(publicAddress('8.8.8.8'),true);
 await assert.rejects(publicFetch('https://public.com/',{requests:0,bytes:0,deadline:Date.now()+1000},{resolve:async()=>[{address:'127.0.0.1'}]}),/Non-public DNS/);
});
test('radar only reports measured changes over an identified observation interval',()=>{
 const a={price:1,volume24h:100,at:100000};
 assert.deepEqual(marketSignals(a,{...a,at:90000}),[]);
 assert.deepEqual(marketSignals(a,{price:2,volume24h:200,at:4000000}),[]);
 assert.equal(marketSignals(a,{price:1.2,volume24h:150,at:400000}).length,2);
 assert.match(marketSignals(a,{price:1.2,volume24h:100,at:400000})[0].message,/20.0%.*5 min/);
 assert.deepEqual(marketSignals({price:0,volume24h:null,at:100000},{price:10,volume24h:100,at:400000}),[]);
});
