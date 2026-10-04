type XReadPost={id:string;text:string;created_at:string;author_id:string;referenced_tweets?:{type:string}[];entities?:{urls?:{url:string;expanded_url:string;media_key?:string}[]};attachments?:{media_keys?:string[]}};
import { ProviderFailure } from './content-providers.ts';
import { XConnectionError } from './x-connection-result.ts';

export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
export type XTokens = { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] };
type XProblem='client-forbidden'|'usage-capped'|'not-authorized-for-resource'|null;
export class XHttpFailure extends ProviderFailure { readonly status:number;readonly retryAt:number|null;readonly problem:XProblem;constructor(status:number,retryAt:number|null=null,problem:XProblem=null){super(true,null,status);this.status=status;this.retryAt=retryAt;this.problem=problem;} }
export class XAccessRevoked extends XHttpFailure { constructor() { super(401);this.uncertain=false; } }
function retryTime(headers:Headers){
 const now=Date.now(),after=headers.get('retry-after'),reset=Number(headers.get('x-rate-limit-reset'))*1000;
 const wait=after===null?NaN:/^\d+(\.\d+)?$/.test(after)?now+Number(after)*1000:Date.parse(after);
 const times=[wait,reset].filter(n=>Number.isFinite(n)&&n>now);
 return times.length?Math.max(...times):now+60000;
}
async function problemType(response:Response):Promise<XProblem>{
 // Return only recognized enums. Provider detail text can contain account IDs
 // or credentials and must never appear in errors, redirects or logs.
 const body=await response.json().catch(()=>null) as {type?:unknown;errors?:{type?:unknown}[]}|null;
 const type=body?.type??(Array.isArray(body?.errors)?body.errors[0]?.type:null);
 for(const problem of ['client-forbidden','usage-capped','not-authorized-for-resource'] as const)
  if(type==='https://api.x.com/2/problems/'+problem||type==='https://api.twitter.com/2/problems/'+problem)return problem;
 return null;
}
// Only a user token's 401 means the owner revoked access; a 401 on the app's
// bearer token is a platform credential problem and never disconnects a coin.
export async function xRequest(token: string, path: string, init: RequestInit = {}, transport: typeof fetch = fetch, allowEmpty = false, userToken = true) {
  let response: Response;
  try { response = await transport('https://api.x.com' + path, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(45000) }); }
  catch { throw new ProviderFailure(); }
  if (response.status === 401 && userToken) throw new XAccessRevoked();
  if (!response.ok) throw new XHttpFailure(response.status,response.status===429?retryTime(response.headers):null,await problemType(response));
  try { return await response.json(); } catch { if (allowEmpty) return {}; throw new ProviderFailure(); }
}
export type XMediaProcessing = { state: 'succeeded' | 'processing' | 'failed'; checkAfterMs: number };
function mediaProcessing(info?: { state?: string; check_after_secs?: number }): XMediaProcessing {
  const wait = Number.isSafeInteger(info?.check_after_secs) && info!.check_after_secs! > 0 ? Math.min(info!.check_after_secs!, 60) * 1000 : 5000;
  if (!info || info.state === 'succeeded') return { state: 'succeeded', checkAfterMs: 0 };
  return { state: info.state === 'failed' ? 'failed' : 'processing', checkAfterMs: wait };
}
const VIDEO_CHUNK_BYTES = 4000000;
type BalanceRead={expiresAt:number;pending?:Promise<number>;value?:number;error?:unknown};
// All coins in this server process use the same app balance. Coalesce concurrent
// reads and short-lived results; never substitute stale credit for a failed read.
const balances=new WeakMap<typeof fetch,Map<string,BalanceRead>>();
async function appBalance(token:string,transport:typeof fetch):Promise<number>{
 if(!token)throw new ProviderFailure(false,0);
 let cache=balances.get(transport);if(!cache){cache=new Map();balances.set(transport,cache)}
 const saved=cache.get(token);
 if(saved?.pending)return saved.pending;
 if(saved&&saved.expiresAt>Date.now()){if(saved.error)throw saved.error;return saved.value!}
 if(cache.size>=16&&!cache.has(token))cache.delete(cache.keys().next().value!);
 const entry:BalanceRead={expiresAt:0};cache.set(token,entry);
 entry.pending=(async()=>{
  try{
   const value=await xRequest(token,'/2/usage/credits',{},transport,false,false) as {data?:{total_balance?:number}},balance=value.data?.total_balance;
   if(typeof balance!=='number'||!Number.isFinite(balance)||balance<0||!Number.isSafeInteger(Math.floor(balance*1e6)))throw new ProviderFailure();
   entry.value=Math.floor(balance*1e6);entry.expiresAt=Date.now()+60000;return entry.value;
  }catch(error){entry.error=error;entry.expiresAt=error instanceof XHttpFailure&&error.status===429?Math.max(Date.now()+1000,error.retryAt??Date.now()+60000):Date.now()+10000;throw error}
  finally{entry.pending=undefined}
 })();
 return entry.pending;
}
export async function exchangeXToken(clientId: string, clientSecret: string, params: Record<string, string>, transport: typeof fetch = fetch): Promise<XTokens> {
  let response: Response;
  try {
    response = await transport('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(encodeURIComponent(clientId) + ':' + encodeURIComponent(clientSecret)), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: clientId }), redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch { throw new XConnectionError('x_unavailable'); }
  if (!response.ok) {
    const detail=await response.json().catch(()=>null) as {error?:unknown}|null;
    if(response.status===401||detail?.error==='invalid_client'||detail?.error==='unauthorized_client')throw new XConnectionError('oauth_client');
    if(detail?.error==='invalid_grant')throw new XConnectionError('expired');
    if(detail?.error==='invalid_scope')throw new XConnectionError('permissions');
    if(response.status===429)throw new XConnectionError('rate_limited');
    throw new XConnectionError(response.status>=500?'x_unavailable':'token_exchange');
  }
  let value:{scope?:string;token_type?:string;access_token?:string;refresh_token?:string;expires_in:number};
  try{value=await response.json()}catch{throw new XConnectionError('x_unavailable')}
  if(!value||typeof value!=='object')throw new XConnectionError('x_unavailable');
  const scopes = typeof value.scope === 'string' ? value.scope.split(' ') : [];
  if (value.token_type?.toLowerCase() !== 'bearer' || typeof value.access_token !== 'string' || !value.access_token || !Number.isSafeInteger(value.expires_in) || value.expires_in < 60) throw new XConnectionError('x_unavailable');
  if(typeof value.refresh_token !== 'string' || !value.refresh_token || !X_SCOPES.every(s => scopes.includes(s)))throw new XConnectionError('permissions');
  return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: Date.now() + value.expires_in * 1000, scopes };
}
export function xProvider(billingToken: string, transport: typeof fetch = fetch) {
  return {
    async balance() {
      return appBalance(billingToken,transport);
    },
    async me(accessToken: string) {
      const value = await xRequest(accessToken, '/2/users/me', {}, transport) as {data?:{id:string;username:string}}, user = value.data;
      if (typeof user?.id !== 'string' || !/^\d+$/.test(user.id) || !/^[A-Za-z0-9_]{1,15}$/.test(user.username)) throw new ProviderFailure();
      return { id: user.id as string, username: user.username as string };
    },
    async upload(session: { accessToken: string }, file: File) {
      const form = new FormData(); form.append('media', file); form.append('media_category', 'tweet_image');
      const result = await xRequest(session.accessToken, '/2/media/upload', { method: 'POST', body: form }, transport) as {data?:{id:string;processing_info?:{state:string}}}, media = result.data;
      if (typeof media?.id !== 'string' || !/^\d+$/.test(media.id) || (media.processing_info && media.processing_info.state !== 'succeeded')) throw new ProviderFailure();
      return media.id as string;
    },
    // Chunked v2 upload: initialize, append ≤5 MB segments, finalize.
    async uploadVideo(session: { accessToken: string }, bytes: Uint8Array) {
      const start = await xRequest(session.accessToken, '/2/media/upload/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_type: 'video/mp4', total_bytes: bytes.length, media_category: 'tweet_video' }) }, transport) as {data?:{id?:string}}, id = start.data?.id;
      if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new ProviderFailure();
      for (let index = 0, offset = 0; offset < bytes.length; index++, offset += VIDEO_CHUNK_BYTES) {
        const form = new FormData(); form.append('segment_index', String(index)); form.append('media', new Blob([bytes.slice(offset, offset + VIDEO_CHUNK_BYTES)], { type: 'application/octet-stream' }));
        await xRequest(session.accessToken, '/2/media/upload/' + id + '/append', { method: 'POST', body: form }, transport, true);
      }
      const done = await xRequest(session.accessToken, '/2/media/upload/' + id + '/finalize', { method: 'POST' }, transport) as {data?:{processing_info?:{state?:string;check_after_secs?:number}}};
      return { mediaId: id, ...mediaProcessing(done.data?.processing_info) };
    },
    async mediaStatus(session: { accessToken: string }, mediaId: string) {
      if (!/^\d+$/.test(mediaId)) throw new ProviderFailure();
      const value = await xRequest(session.accessToken, '/2/media/upload?' + new URLSearchParams({ command: 'STATUS', media_id: mediaId }), {}, transport) as {data?:{processing_info?:{state?:string;check_after_secs?:number}}};
      return mediaProcessing(value.data?.processing_info);
    },
    async post(session: { accessToken: string }, text: string, mediaId?: string | null) {
      const result = await xRequest(session.accessToken, '/2/tweets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }) }, transport) as {data?:{id:string}};
      if (typeof result.data?.id !== 'string' || !/^\d+$/.test(result.data.id)) throw new ProviderFailure();
      return result.data.id as string;
    },
    async tweets(session: { accessToken: string }, userId: string, id?: string, since?: number) {
      if (!/^\d+$/.test(userId) || (id && !/^\d+$/.test(id))) throw new ProviderFailure();
      const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at,attachments,entities,referenced_tweets' });
      if (!id) { params.set('max_results', '10'); params.set('exclude', 'retweets,replies'); if (since && since < Date.now() - 15000) params.set('start_time', new Date(since).toISOString()); }
      const result = await xRequest(session.accessToken, (id ? '/2/tweets/' + id : '/2/users/' + userId + '/tweets') + '?' + params, {}, transport) as {errors?:unknown[];data?:XReadPost|XReadPost[]};
      if (result.errors?.length) throw new ProviderFailure();
      const tweets = id ? [result.data] : result.data ?? [];
      if (!Array.isArray(tweets) || tweets.length > 10) throw new ProviderFailure();
      if(tweets.some(v=>!v||Array.isArray(v)||typeof v.id!=="string"||typeof v.text!=="string"))throw new ProviderFailure();
      return (tweets as XReadPost[]).map(v => ({ id: v.id, text: v.text, createdAt: v.created_at, author: { id: v.author_id }, isReply: v.referenced_tweets?.some((r: { type: string }) => r.type === 'replied_to'), isRetweet: v.referenced_tweets?.some((r: { type: string }) => r.type === 'retweeted'), quoted_tweet: v.referenced_tweets?.some((r: { type: string }) => r.type === 'quoted') || undefined, entities: { urls: v.entities?.urls?.map((u: { url: string; expanded_url: string }) => ({ url: u.url, expanded_url: u.expanded_url })) }, extendedEntities: { media: v.attachments?.media_keys?.map((key: string) => ({ id_str: key.split('_').slice(1).join('_'), url: v.entities?.urls?.find((u: { media_key?: string }) => u.media_key === key)?.url })) } }));
    },
  };
}
