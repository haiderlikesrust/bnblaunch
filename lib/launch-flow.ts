import { stringToHex } from "viem";
import { findSalt } from "./flap";
import { coinTweetUrl } from "./coin-tweet";
import { connectWallet } from "./wallet-login";

// Client-side launch sequence shared by the create form and the resume panel.
export type LaunchPlan={planId:string;transaction:Record<string,string>;predictedAddress:string;treasury:string;initialBuyBnb:string;quoteSymbol?:string;quoteToken?:string;estimatedGasBnb:string};
export type LaunchStage="wallet"|"create"|"authorize"|"metadata"|"validate"|"send"|"confirm";
export type LaunchStatus={launched:boolean;pending:{planId:string;hash:string;state:string}|null;readiness:{ready:boolean;reason:string}};
export class LaunchFlowError extends Error{readonly code:string;readonly status:number;constructor(message:string,code="",status=0){super(message);this.code=code;this.status=status;}}
const BSC={chainId:"0x38",chainName:"BNB Smart Chain",nativeCurrency:{name:"BNB",symbol:"BNB",decimals:18},rpcUrls:["https://bsc-dataseed.bnbchain.org"],blockExplorerUrls:["https://bscscan.com"]};
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function provider(){if(!window.ethereum)throw new LaunchFlowError("Open QI in a browser with a BNB-compatible wallet such as MetaMask or Rabby.");return window.ethereum;}
async function launchApi<T>(coinId:string,data:unknown):Promise<T>{
 const r=await fetch(`/api/coins/${encodeURIComponent(coinId)}/launch`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
 const value=await r.json().catch(()=>({})) as {error?:string;code?:string};
 if(!r.ok)throw new LaunchFlowError(value.error??"The launch request failed.",value.code??"",r.status);
 return value as T;
}
export async function launchStatus(coinId:string):Promise<LaunchStatus>{
 const r=await fetch(`/api/coins/${encodeURIComponent(coinId)}/launch`,{cache:"no-store"});
 const value=await r.json().catch(()=>({})) as Partial<LaunchStatus>&{error?:string};
 if(!r.ok)throw new LaunchFlowError(value.error??"The launch wallet service is unavailable.","",r.status);
 return {launched:!!value.launched,pending:value.pending??null,readiness:value.readiness??{ready:false,reason:"The launch wallet service is unavailable."}};
}
// Connects the wallet, switches to BNB Chain and signs in that same wallet.
export async function readyWallet(){
 const wallet=provider();
 const accounts=await wallet.request({method:"eth_requestAccounts"}) as string[],account=accounts[0];
 if(!account)throw new LaunchFlowError("Connect your wallet to launch.");
 if(await wallet.request({method:"eth_chainId"})!=="0x38"){
  try{await wallet.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x38"}]});}
  catch(error){if((error as {code?:number})?.code===4902)await wallet.request({method:"wallet_addEthereumChain",params:[BSC]}).catch(()=>undefined);}
  if(await wallet.request({method:"eth_chainId"})!=="0x38")throw new LaunchFlowError("Switch your wallet to BNB Chain (56), then launch again.");
 }
 const session=await fetch("/api/auth",{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null) as {user?:{userId?:string}|null}|null;
 if(session?.user?.userId?.toLowerCase()!==account.toLowerCase()){
  const signed=await connectWallet();
  if(signed.toLowerCase()!==account.toLowerCase())throw new LaunchFlowError("Your wallet account changed. Launch again.");
 }
 return account;
}
export async function prepareLaunch({coinId,hasSavedImage,file,account,buy,tweetUrl,onStage}:{coinId:string;hasSavedImage:boolean;file?:File|null;account:string;buy:string;tweetUrl:string;onStage:(stage:LaunchStage)=>void}){
 if(!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(buy))throw new LaunchFlowError("Enter a non-negative developer buy in the selected pair token, with at most 18 decimals.");
 const tweet=coinTweetUrl.safeParse(tweetUrl);if(!tweet.success)throw new LaunchFlowError(tweet.error.issues[0].message);
 if(!file&&!hasSavedImage)throw new LaunchFlowError("Choose a token logo first.");
 onStage("authorize");
 const auth=await launchApi<{authorizationId:string;message:string;approvals?:Record<string,string>[]}>(coinId,{action:"authorize",creator:account,initialBuyBnb:buy,tweetUrl:tweet.data});
 const signature=await provider().request({method:"personal_sign",params:[stringToHex(auth.message),account]}) as string;
 for(const transaction of auth.approvals??[]){const hash=await walletSend(transaction);await waitWalletReceipt(hash);}
 onStage("metadata");
 let pinned:Response;
 if(hasSavedImage)pinned=await fetch(`/api/coins/${encodeURIComponent(coinId)}/metadata`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({useSavedImage:true,authorizationId:auth.authorizationId})});
 else{const form=new FormData();form.append("authorizationId",auth.authorizationId);form.append("image",file!);pinned=await fetch(`/api/coins/${encodeURIComponent(coinId)}/metadata`,{method:"POST",body:form});}
 const metadata=await pinned.json().catch(()=>({})) as {cid?:string;error?:string};
 if(!pinned.ok||!metadata.cid)throw new LaunchFlowError(metadata.error??"Your logo and metadata could not be pinned. Launch again.");
 onStage("validate");
 const salt=await findSalt();
 return launchApi<LaunchPlan>(coinId,{action:"prepare",authorizationId:auth.authorizationId,signature,cid:metadata.cid,salt:salt.salt});
}
// The wallet shows the exact transaction; its approval is the final confirmation.
export async function sendLaunch(coinId:string,plan:LaunchPlan){
 const status=await launchStatus(coinId);
 if(status.launched)throw new LaunchFlowError("This token is already launched.");
 if(status.pending&&status.pending.planId!==plan.planId)throw new LaunchFlowError("Another launch transaction for this coin is still pending.");
 if(!status.readiness.ready)throw new LaunchFlowError(status.readiness.reason);
 const wallet=provider(),accounts=await wallet.request({method:"eth_accounts"}) as string[],chain=await wallet.request({method:"eth_chainId"});
 if(chain!=="0x38"||accounts[0]?.toLowerCase()!==plan.transaction.from.toLowerCase())throw new LaunchFlowError("Your wallet account or network changed. Launch again.");
 const hash=await wallet.request({method:"eth_sendTransaction",params:[plan.transaction]}) as string;
 if(!/^0x[a-fA-F0-9]{64}$/.test(hash))throw new LaunchFlowError("The wallet returned an invalid transaction hash.");
 rememberLaunch(coinId,plan.planId,hash);
 await recordSubmission(coinId,plan.planId,hash);
 return hash;
}
async function walletSend(transaction:Record<string,string>){
 const wallet=provider(),accounts=await wallet.request({method:'eth_accounts'}) as string[];
 if(await wallet.request({method:'eth_chainId'})!=='0x38'||accounts[0]?.toLowerCase()!==transaction.from.toLowerCase())throw new LaunchFlowError('Your wallet account or network changed. Retry.');
 const hash=await wallet.request({method:'eth_sendTransaction',params:[transaction]}) as string;
 if(!/^0x[a-fA-F0-9]{64}$/.test(hash))throw new LaunchFlowError('Wallet returned an invalid transaction hash.');return hash;
}
async function waitWalletReceipt(hash:string){
 for(let i=0;i<80;i++){const receipt=await provider().request({method:'eth_getTransactionReceipt',params:[hash]}) as {status:string}|null;if(receipt){if(receipt.status!=='0x1')throw new LaunchFlowError('Token approval reverted.');return;}await wait(3000);}
 throw new LaunchFlowError('Token approval is still pending. Wait for it to confirm before retrying.');
}
export async function fundAgentGas(coinId:string){
 type Result={ready?:boolean;pending?:boolean;reverted?:boolean;hash?:string;transaction?:Record<string,string>;error?:string};
 const api=async(data:unknown):Promise<Result>=>{const r=await fetch(`/api/coins/${encodeURIComponent(coinId)}/gas`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json() as Result;if(!r.ok)throw new LaunchFlowError(v.error??'Gas deposit verification pending. Do not send another deposit.','',r.status);return v;};
 const storage='shen-agent-gas:'+coinId;
 let local:string|null=null;try{local=sessionStorage.getItem(storage)}catch{}
 if(local)try{await api({action:'submitted',hash:local});}catch(e){if(e instanceof LaunchFlowError&&e.status===400){try{sessionStorage.removeItem(storage)}catch{}}throw e;}
 const deposit=await api({action:'prepare'});if(deposit.ready){try{sessionStorage.removeItem(storage)}catch{}return;}
 if(!deposit.pending){
  if(!deposit.transaction)throw new LaunchFlowError('Gas deposit could not be prepared.');
  const hash=await walletSend(deposit.transaction);try{sessionStorage.setItem(storage,hash)}catch{}
  await api({action:'submitted',hash});
 }
 for(let i=0;i<80;i++){await wait(3000);let result:Result;try{result=await api({action:'confirm'});}catch(e){if(i===79)throw e;continue;}if(result.reverted){try{sessionStorage.removeItem(storage)}catch{}throw new LaunchFlowError(result.error??'Gas deposit reverted.');}if(result.ready){try{sessionStorage.removeItem(storage)}catch{}return;}}
 throw new LaunchFlowError('Gas deposit is still confirming. Retry verification without sending another deposit.');
}
// Saved server-side so any device can finish verification. Confirmation does
// not depend on it, so a brief outage only retries.
export async function recordSubmission(coinId:string,planId:string,hash:string){
 for(let attempt=0;attempt<3;attempt++){try{await launchApi(coinId,{action:"submitted",planId,hash});return true;}catch(error){if(error instanceof LaunchFlowError&&error.status>=400&&error.status<500)return false;await wait(1500);}}
 return false;
}
const key=(coinId:string)=>"shen-launch:"+coinId;
export function rememberLaunch(coinId:string,planId:string,hash:string){try{sessionStorage.setItem(key(coinId),JSON.stringify({planId,hash}))}catch{}}
export function forgetLaunch(coinId:string){try{sessionStorage.removeItem(key(coinId))}catch{}}
export function rememberedLaunch(coinId:string){
 try{const value=JSON.parse(sessionStorage.getItem(key(coinId))??"null") as {planId?:string;hash?:string}|null;return value?.planId&&/^0x[a-fA-F0-9]{64}$/.test(value.hash??"")?{planId:value.planId,hash:value.hash!}:null;}catch{return null}
}
