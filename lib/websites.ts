import { db } from './server';
import { websiteInput, websitePath, type AgentWebsite } from './website-policy';
import type { Coin } from './model';

export function websiteStatements(lease:{coinId:string;id:string},runId:string,site:AgentWebsite,now:number){
 const content=JSON.stringify(websiteInput.parse(site));
 return [db().prepare(`INSERT INTO site_revisions(id,coin_id,revision,content,published_at)
 SELECT ?,?,COALESCE((SELECT MAX(revision) FROM site_revisions WHERE coin_id=?),0)+1,?,?
 WHERE EXISTS(SELECT 1 FROM runtime_leases l JOIN coins c ON c.id=l.coin_id WHERE l.coin_id=? AND l.lease_id=? AND l.lease_until>? AND c.token_address IS NOT NULL AND json_extract(c.config,'$.lastPlanRunId')=?)
 AND COALESCE((SELECT content FROM site_revisions WHERE coin_id=? ORDER BY revision DESC LIMIT 1),'')!=?
 ON CONFLICT(id) DO NOTHING`).bind(runId,lease.coinId,lease.coinId,content,now,lease.coinId,lease.id,now,runId,lease.coinId,content),
 db().prepare(`INSERT INTO events(id,coin_id,owner,name,message,created_at)
 SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND EXISTS(SELECT 1 FROM site_revisions WHERE id=?) ON CONFLICT(id) DO NOTHING`)
 .bind('website:'+runId,'Website published: '+websitePath(lease.coinId),new Date(now).toISOString(),lease.coinId,runId)];
}

export async function publishedWebsite(coinId:string){
 const row=await db().prepare(`SELECT s.content,s.revision,s.published_at,c.config FROM site_revisions s JOIN coins c ON c.id=s.coin_id
 WHERE s.coin_id=? AND c.token_address IS NOT NULL ORDER BY s.revision DESC LIMIT 1`).bind(coinId).first<{content:string;revision:number;published_at:number;config:string}>();
 if(!row)return null;
 return {coin:JSON.parse(row.config) as Coin,site:{...websiteInput.parse(JSON.parse(row.content)),revision:row.revision,publishedAt:row.published_at,url:websitePath(coinId)}};
}
