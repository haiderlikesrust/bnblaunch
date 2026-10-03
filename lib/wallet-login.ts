"use client";
import { stringToHex } from "viem";
export async function connectWallet(){
  if(!window.ethereum)throw Error("Open in a browser with MetaMask or Rabby.");
  const accounts=await window.ethereum.request({method:"eth_requestAccounts"}) as string[];
  if(!accounts[0])throw Error("Connect your wallet first.");
  const post=async(data:unknown)=>{const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const value=await r.json() as {id:string;message:string;error?:string};if(!r.ok)throw Error(value.error??'Wallet sign-in failed');return value};
  const challenge=await post({action:'challenge',wallet:accounts[0]});
  const signature=await window.ethereum.request({method:'personal_sign',params:[stringToHex(challenge.message),accounts[0]]});
  await post({action:'verify',id:challenge.id,signature});
  window.dispatchEvent(new Event('shen-auth-changed'));return accounts[0];
}
