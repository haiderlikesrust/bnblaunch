import { confirmedBalance } from "./providers";

type Snapshot={balanceWei:string;balance:number;block:string;observedAt:number};
const snapshots=new Map<string,{expiresAt:number;value:Promise<Snapshot>}>();

// Collapse concurrent viewers' reads; this cache never authorizes spending or
// changes the worker's operating state. Rejected reads are not cached as zero.
export function treasuryBalance(address:string):Promise<Snapshot>{
  const key=address.toLowerCase(),now=Date.now(),cached=snapshots.get(key);
  if(cached&&cached.expiresAt>now)return cached.value;
  const value=confirmedBalance(address).then(result=>({balanceWei:result.wei.toString(),balance:result.bnb,block:result.block,observedAt:Date.now()}));
  const entry={expiresAt:now+15000,value};
  if(snapshots.size>=1000)snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(key,entry);
  void value.catch(()=>{if(snapshots.get(key)===entry)snapshots.delete(key)});
  return value;
}
