"use client";
import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Wallet } from "lucide-react";
import { connectWallet } from "@/lib/wallet-login";
import { QiNotice } from "@/components/qi-page";
export default function SignIn(){const [busy,setBusy]=useState(false),[error,setError]=useState('');async function sign(){setBusy(true);try{await connectWallet();const next=new URLSearchParams(window.location.search).get('return_to')??'/agents';const target=new URL(next,window.location.origin);// An absolute same-origin href: a path such as "//evil.com" would leave the site.
window.location.assign(target.origin===window.location.origin?target.href:'/agents')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}return <QiNotice kicker="QI · SIGN IN" title="Connect" outline="your wallet."><p className="qi-lead">Sign a message to access your launch plans and agents. No transaction or gas is required.</p><div className="qi-notice-actions"><button className="qi-btn" disabled={busy} onClick={sign}>{busy?<LoaderCircle className="spin" size={15}/>:<Wallet size={15}/>}{busy?'Waiting for wallet…':'Sign in with wallet'}</button><Link className="qi-btn qi-btn-ghost" href="/">Back to QI</Link></div>{error&&<p className="form-error" role="alert">{error}</p>}</QiNotice>}
