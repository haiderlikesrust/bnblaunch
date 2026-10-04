import type { Coin } from "./model";

// final: retrying the same hash cannot succeed (reverted, mismatched, replaced).
export class LaunchConfirmationError extends Error{
  readonly status:number;readonly code:string;readonly final:boolean;
  constructor(message:string,status=0,code="",final=false){super(message);this.name="LaunchConfirmationError";this.status=status;this.code=code;this.final=final;}
}
// AbortSignal.any and .timeout are missing from older Safari and some wallet browsers.
export function anySignal(signals:AbortSignal[]){
  if(typeof AbortSignal.any==="function")return AbortSignal.any(signals);
  const controller=new AbortController();
  for(const signal of signals){if(signal.aborted){controller.abort(signal.reason);break;}signal.addEventListener("abort",()=>controller.abort(signal.reason),{once:true});}
  return controller.signal;
}
export function timeoutSignal(ms:number){
  if(typeof AbortSignal.timeout==="function")return AbortSignal.timeout(ms);
  const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException("The operation timed out.","TimeoutError")),ms);return controller.signal;
}
function pause(ms:number,signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    signal.throwIfAborted();
    const abort=()=>{clearTimeout(timer);reject(signal.reason)};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve()},ms);
    signal.addEventListener("abort",abort,{once:true});
  });
}

// Rechecks an already-submitted transaction. Never sends a wallet transaction.
export async function confirmLaunch({coinId,planId,hash,signal,onPending,intervalMs=5000,maxAttempts=120}:{coinId:string;planId:string;hash:string;signal:AbortSignal;onPending:(message:string)=>void;intervalMs?:number;maxAttempts?:number}):Promise<Coin>{
  let failures=0;
  const started=Date.now();
  for(let attempt=0;attempt<maxAttempts&&Date.now()-started<600000;attempt++){
    signal.throwIfAborted();
    let response:Response;
    try{
      response=await fetch(`/api/coins/${coinId}/launch`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm",planId,hash}),signal:anySignal([signal,timeoutSignal(15000)])});
    }catch{
      signal.throwIfAborted();
      if(++failures>=5)throw new LaunchConfirmationError("Connection interrupted. Your transaction is saved; retry verification when connected.");
      onPending("Connection interrupted. Retrying launch verification automatically…");
      await pause(intervalMs,signal);continue;
    }
    const data=await response.json().catch(()=>null) as {status?:string;message?:string;error?:string;code?:string;coin?:Coin}|null;
    signal.throwIfAborted();
    if(response.status===200&&data?.coin?.tokenAddress)return data.coin;
    if(response.status===202&&data?.status==="pending"){
      failures=0;onPending(data.message??"Confirming launch on BNB Chain…");
    }else if(response.status===429||response.status>=500){
      if(++failures>=5)throw new LaunchConfirmationError(data?.error??"Verification is temporarily unavailable. Your transaction is saved; retry verification shortly.",response.status);
      onPending("Verification is temporarily unavailable. Retrying automatically…");
    }else throw new LaunchConfirmationError(data?.error??"Could not verify this launch. Your transaction is saved.",response.status,data?.code??"",response.status===400||response.status===409);
    await pause(intervalMs,signal);
  }
  throw new LaunchConfirmationError("This transaction is taking longer to confirm. Your transaction is saved; view it on BscScan or retry verification.");
}
