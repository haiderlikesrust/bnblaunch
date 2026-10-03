import { resolve as runtimeResolve } from './runtime-loader.mjs';
export async function resolve(specifier,context,next){
 if(specifier==='./providers'&&context.parentURL?.includes('/lib/'))return {url:'data:text/javascript,export const chainClient=()=>globalThis.__plannerChain;export const research=async()=>[];',shortCircuit:true};
 return runtimeResolve(specifier,context,next);
}
