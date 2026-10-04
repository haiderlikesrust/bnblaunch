"use client";
import Link from "next/link";
import { QiNotice } from "@/components/qi-page";
// Route-level fallback: a rendering error shows a recoverable page instead of a blank screen.
export default function RouteError({reset}:{error:Error&{digest?:string};reset:()=>void}){
  return <QiNotice kicker="QI · ERROR" title="Something" outline="went wrong."><p className="qi-lead">This page hit an unexpected error. Your wallet, coins and any submitted launch are unaffected.</p><div className="qi-notice-actions"><button className="qi-btn" onClick={reset}>Try again</button><Link className="qi-btn qi-btn-ghost" href="/">Back to QI</Link></div></QiNotice>;
}
