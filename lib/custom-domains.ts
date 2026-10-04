import {db} from './server';

export type PublicDomain={domain:string;state:'provisioning'|'live'|'degraded';expiresAt:number|null;error:string|null;custody:'QI-managed registrar account';registered:boolean;progress:'pricing'|'funding'|'registering'|'renewing'|'connecting'|'review'|null};
export async function publicDomain(coinId:string):Promise<PublicDomain|null>{
 const [row,pending]=await Promise.all([
 db().prepare(`SELECT d.domain,d.state,d.expires_at,d.last_error FROM coin_domains d JOIN coins c ON c.id=d.coin_id WHERE d.coin_id=? AND c.token_address IS NOT NULL`).bind(coinId).first<{domain:string;state:PublicDomain['state'];expires_at:number|null;last_error:string|null}>(),
 db().prepare(`SELECT o.domain,o.status,o.kind FROM domain_orders o JOIN coins c ON c.id=o.coin_id WHERE o.coin_id=? AND c.token_address IS NOT NULL ORDER BY o.created_at DESC LIMIT 1`).bind(coinId).first<{domain:string;status:string;kind:string}>(),
 ]);
 if(!row&&!pending)return null;
 const progress:PublicDomain['progress']=pending&&pending.status!=='live'?['review','failed'].includes(pending.status)?'review':pending.status==='queued'?'pricing':pending.status==='funding'?'funding':['reserve','purchase'].includes(pending.status)?pending.kind==='renew'?'renewing':'registering':'connecting':null;
 if(!row)return {domain:pending!.domain,state:progress==='review'?'degraded':'provisioning',expiresAt:null,error:progress==='review'?'Domain setup needs attention. The QI website remains available.':null,custody:'QI-managed registrar account',registered:false,progress};
 const expired=row.expires_at!=null&&row.expires_at<=Date.now();
 return {domain:row.domain,state:expired?'degraded':row.state,expiresAt:row.expires_at,error:expired?'Domain renewal is pending. The QI website remains available.':row.last_error?'The agent is completing the domain setup. The QI website remains available.':null,custody:'QI-managed registrar account',registered:true,progress};
}
