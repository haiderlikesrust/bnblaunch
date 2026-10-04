import {resolve as runtimeResolve} from './runtime-loader.mjs';
export async function resolve(specifier,context,next){
 if(specifier==='next/headers')return {url:'data:text/javascript,export function cookies(){return {get(name){const value=globalThis.__xTestCookies?.[name];return value?{value}:undefined}}}',shortCircuit:true};
 return runtimeResolve(specifier,context,next);
}
