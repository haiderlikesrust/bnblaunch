import { resolve as runtimeResolve } from './runtime-loader.mjs';
export async function resolve(specifier,context,next){
 if(specifier==='next/headers')return {url:'data:text/javascript,export function cookies(){return {get(name){return name==="shen_session"&&globalThis.__chatTestSession?{value:globalThis.__chatTestSession}:undefined}}}',shortCircuit:true};
 return runtimeResolve(specifier,context,next);
}
