"use client";
import Link from "next/link";
// Route-level fallback: a rendering error shows a recoverable page instead of a blank screen.
export default function RouteError({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <main className="panel" style={{maxWidth:560,margin:"12vh auto",padding:32}}><Link href="/" className="eyebrow">SHEN · 神</Link><h1>Something went wrong.</h1><p className="body-copy">This page hit an unexpected error. Your wallet, coins and any submitted launch are unaffected.</p><button className="button primary" style={{marginTop:20}} onClick={reset}>Try again</button></main>;
}
