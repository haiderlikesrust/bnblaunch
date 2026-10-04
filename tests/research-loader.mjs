import { resolve as runtimeResolve } from './runtime-loader.mjs';
export async function resolve(specifier, context, next) {
  if (specifier === '@/lib/auth') return { url: 'data:text/javascript,export const validOrigin=()=>true;export async function getUser(){return globalThis.__researchViewer??null}', shortCircuit: true };
  return runtimeResolve(specifier, context, next);
}
