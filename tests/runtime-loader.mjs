import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier,context,next){
 if(specifier.startsWith('@/'))for(const extension of ['','.ts','.mjs']){const url=new URL('../'+specifier.slice(2)+extension,import.meta.url);if(existsSync(fileURLToPath(url)))return {url:url.href,shortCircuit:true};}
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__shenTestEnv;',shortCircuit:true};
 if(specifier==='next/headers')return {url:'data:text/javascript,export function cookies(){throw Error("No browser auth in worker tests")}',shortCircuit:true};
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')&&!/\.(ts|mjs|js|json)$/.test(specifier))for(const extension of ['.ts','.mjs']){const url=new URL(specifier+extension,context.parentURL);if(existsSync(fileURLToPath(url)))return {url:url.href,shortCircuit:true};}
 return next(specifier,context);
}
