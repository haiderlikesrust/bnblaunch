import { fileURLToPath } from 'node:url';
import {spawn} from 'node:child_process';
import {copyFile,mkdir,writeFile} from 'node:fs/promises';
const cli=new URL('../node_modules/vinext/dist/cli.js',import.meta.url);
await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[fileURLToPath(cli),'build'],{stdio:'inherit',env:{...process.env,SHEN_RUNTIME:'node',NODE_ENV:'production'}});
 child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Production build failed ('+code+')')));
});
const output=new URL('../dist/standalone/',import.meta.url);
for(const folder of ['shen/server/','shen/shared/'])await mkdir(new URL(folder,output),{recursive:true});
for(const path of ['server/start.mjs','server/custom-host-router.mjs','shared/domain-host.mjs'])await copyFile(new URL('../'+path,import.meta.url),new URL('shen/'+path,output));
await writeFile(new URL('server.js',output),`#!/usr/bin/env node\nimport {join} from 'node:path';\nimport {startShenServer} from './shen/server/start.mjs';\nstartShenServer({outDir:join(import.meta.dirname,'dist')}).catch(()=>{console.error('SHEN server could not start');process.exit(1);});\n`);
console.log('Installed SHEN custom-domain request routing in standalone output.');
