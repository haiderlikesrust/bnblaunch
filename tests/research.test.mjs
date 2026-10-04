import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
register('./research-loader.mjs', import.meta.url);
const env = globalThis.__shenTestEnv = {};
const { researchSources } = await import('../lib/research-preview.ts');
const { recordResearch, researchHistory } = await import('../lib/research-history.ts');
const { GET } = await import('../app/api/coins/[id]/research/route.ts');
const { GET: consoleGET } = await import('../app/api/coins/[id]/console/route.ts');
const { GET: platformGET } = await import('../app/api/platform/route.ts');
function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync('drizzle/' + name, 'utf8'));
  function prepare(query, args = []) { return { bind(...values) { return prepare(query, values); }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; }, async first() { return sql.prepare(query).get(...args) ?? null; }, async all() { return { results: sql.prepare(query).all(...args) }; } }; }
  env.DB = { prepare };
  sql.prepare("INSERT INTO coins(id,owner,config,created_at,updated_at,token_address) VALUES(?,?,?,?,?,?)").run('coin', 'owner', '{}', 'now', 'now', '0x1');
  return sql;
}
const coin = { id: 'coin', name: 'Jade', symbol: 'JADE' };
test('preview rejects active schemes, embedded credentials and duplicate sources', () => {
  assert.deepEqual(researchSources([{ url: 'javascript:alert(1)' }, { url: 'https://secret:password@example.com' }, { url: 'https://example.com', title: 'Source', description: 'Excerpt' }, { url: 'https://example.com' }, { url: 'not a URL' }]), [{ url: 'https://example.com/', title: 'Source', description: 'Excerpt' }]);
});
test('records actual search lifecycle and exposes only public research fields', async () => {
  const sql = fixture();
  try {
    await recordResearch(coin, 'run', async () => {
      assert.equal((await researchHistory('coin'))[0].status, 'searching');
      return [{ title: 'News', url: 'https://example.com/news', description: 'Snippet', privateKey: 'never disclose' }];
    });
    globalThis.__researchViewer = null;
    const response = await GET(new Request('https://shen.now/api/coins/coin/research'), { params: Promise.resolve({ id: 'coin' }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.searches[0].status, 'complete');
    assert.equal(data.searches[0].query, 'Jade JADE BNB');
    assert.ok(data.searches[0].finishedAt);
    assert.equal(JSON.stringify(data).includes('privateKey'), false);
    sql.exec("UPDATE coins SET token_address=NULL");
    assert.equal((await GET(new Request('https://shen.now'), { params: Promise.resolve({ id: 'coin' }) })).status, 404);
    globalThis.__researchViewer = { userId: 'someone-else' };
    assert.equal((await GET(new Request('https://shen.now'), { params: Promise.resolve({ id: 'coin' }) })).status, 404);
    globalThis.__researchViewer = { userId: 'owner' };
    assert.equal((await GET(new Request('https://shen.now'), { params: Promise.resolve({ id: 'coin' }) })).status, 200);
  } finally { sql.close(); globalThis.__researchViewer = null; }
});
test('failures retain no provider secrets; stale searches stop claiming live activity', async () => {
  const sql = fixture();
  try {
    await assert.rejects(recordResearch(coin, 'failed', async () => { throw Error('secret provider credential'); }));
    const failed = (await researchHistory('coin'))[0];
    assert.equal(failed.status, 'unavailable');
    assert.equal(JSON.stringify(failed).includes('secret'), false);
    await recordResearch(coin, 'empty', async () => []);
    assert.equal(sql.prepare("SELECT status FROM research_runs WHERE id='empty'").get().status, 'complete');
    sql.prepare("INSERT INTO research_runs VALUES('stale','coin','query','searching','[]',?,NULL)").run(Date.now() - 180000);
    assert.equal((await researchHistory('coin')).find(r => r.id === 'stale').status, 'interrupted');
  } finally { sql.close(); }
});

test('console is public only after launch, reports stale workers and excludes private context',async()=>{
 const sql=fixture();try{
  sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...coin,tokenAddress:'0x1',balance:1,threshold:.1}));
  const get=()=>consoleGET(new Request('https://shen.now'),{params:Promise.resolve({id:'coin'})});
  assert.equal((await (await get()).json()).state,'worker_unconfirmed');
  sql.prepare("INSERT INTO runtime_health(id,checked_at,capabilities,version) VALUES('worker',?,?,'1')").run(Date.now(),JSON.stringify(['autonomous-planning']));
  sql.prepare("INSERT INTO research_runs VALUES('active','coin','query','searching','[]',?,NULL)").run(Date.now());
  sql.prepare("INSERT INTO agent_memories VALUES('private','coin','private summary','private next steps',?)").run(Date.now());
  const live=await (await get()).json();assert.equal(live.state,'researching');assert.equal(live.memory.entries,1);assert.equal(JSON.stringify(live).includes('private'),false);
  sql.prepare('UPDATE research_runs SET started_at=?').run(Date.now()-180000);
  assert.equal((await (await get()).json()).state,'check_unconfirmed');
  sql.prepare('UPDATE runtime_health SET checked_at=?').run(Date.now()-180001);
  assert.equal((await (await get()).json()).state,'worker_unconfirmed');
  sql.exec('UPDATE coins SET token_address=NULL');globalThis.__researchViewer=null;assert.equal((await get()).status,404);
  globalThis.__researchViewer={userId:'someone-else'};assert.equal((await get()).status,404);
  globalThis.__researchViewer={userId:'owner'};assert.equal((await get()).status,200);
 }finally{sql.close();globalThis.__researchViewer=null;}
});

test('public platform configuration publishes only a valid contract and the official X link',async()=>{
 try{
  env.OPENROUTER_API_KEY='never-public';
  for(const invalid of ['', '0x0000000000000000000000000000000000000000','not-an-address']){
   env.SHEN_TOKEN_ADDRESS=invalid;assert.equal((await platformGET().json()).shenTokenAddress,null);
  }
  env.SHEN_TOKEN_ADDRESS='0x1111111111111111111111111111111111117777';
  assert.deepEqual(await platformGET().json(),{shenTokenAddress:env.SHEN_TOKEN_ADDRESS,xUrl:'https://x.com/qidotnow',influencer:{available:false,dailyPosts:6,videos:false}});
 }finally{delete env.SHEN_TOKEN_ADDRESS;delete env.OPENROUTER_API_KEY;}
});

test('routine checks preserve a rejected plan outcome and expose the separate planning schedule',async()=>{
 const sql=fixture(),now=Date.now(),started=new Date(now-60000).toISOString();
 try{
  sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...coin,tokenAddress:'0x1'}));
  sql.prepare("INSERT INTO runtime_health(id,checked_at,capabilities,version) VALUES('worker',?,?,'1')").run(now,JSON.stringify(['autonomous-planning']));
  sql.prepare("INSERT INTO runtime_leases(coin_id,lease_until,next_run_at,next_plan_at,last_checked_at,last_reason) VALUES('coin',0,?,?,?,'awaiting_next_plan')").run(now+60000,now+840000,now);
  sql.prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at,finished_at,output) VALUES('attempt','coin','plan','settled',100,?,?,?)").run(started,new Date(now-45000).toISOString(),'private rejected output');
  const get=async()=>await (await consoleGET(new Request('https://shen.now'),{params:Promise.resolve({id:'coin'})})).json();
  const rejected=await get();assert.equal(rejected.state,'planning_retry_scheduled');assert.equal(rejected.nextCheckAt,now+60000);assert.equal(rejected.nextPlanAt,now+840000);assert.equal(rejected.lastPlan.outcome,'not_approved');assert.equal(JSON.stringify(rejected).includes('private'),false);
  sql.prepare('UPDATE agent_runs SET output=?').run(JSON.stringify({rejection:{code:'schema',issues:[{path:['summary'],rule:'too_big',limit:400}]}}));
  assert.match((await get()).lastPlan.rejection.message,/summary: exceeds the maximum of 400/);
  sql.prepare('UPDATE agent_runs SET output=?').run(JSON.stringify({rejection:{code:'guard_denied',reviewReason:'private review text'}}));
  const reviewed=await get();assert.equal(reviewed.lastPlan.rejection.code,'guard_denied');assert.equal(JSON.stringify(reviewed).includes('private'),false);
  sql.prepare('UPDATE agent_runs SET output=?').run(JSON.stringify({rejection:{code:'schema',issues:[{path:['private-secret-key'],rule:'too_big',limit:400}]}}));
  assert.equal((await get()).lastPlan.rejection,null);
  sql.prepare("INSERT INTO agent_memories VALUES('attempt','coin','private summary','private next steps',?)").run(now);
  const approved=await get();assert.equal(approved.state,'scheduled');assert.equal(approved.lastPlan.outcome,'approved');assert.equal(JSON.stringify(approved).includes('private'),false);
  sql.prepare("INSERT INTO content_jobs(id,coin_id,payload,status,created_at,updated_at) VALUES('held','coin','{}','uncertain',?,?)").run(now,now);
  const held=await get();assert.equal(held.state,'scheduled');assert.equal(held.publicationNeedsVerification,true);
 }finally{sql.close();}
});


test('research follows approved next topics or mission context rather than a token-name collision',async()=>{
 const {researchQuery}=await import('../lib/research-preview.ts');
 assert.equal(researchQuery({name:'MARTIAN',symbol:'MARTIAN',purpose:'Explore Mars science'}),'Explore Mars science');
 assert.equal(researchQuery({name:'MARTIAN',symbol:'MARTIAN',focus:'Atmosphere',purpose:'Mars',nextResearchQuery:'Latest rover findings'}),'Latest rover findings');
 assert.equal(researchQuery({name:'A',symbol:'A',nextResearchQuery:'x'.repeat(500)}).length,240);
});

test('browser captures are coin-scoped and private until launch; API returns frame links only',async()=>{
 const sql=fixture();const {GET:frameGET}=await import('../app/api/coins/[id]/research/browser/[frameId]/route.ts');
 try{
  sql.prepare("INSERT INTO browser_sessions(id,coin_id,url,title,status,excerpt,started_at,finished_at) VALUES('visit','coin','https://example.com/','Page','complete','Full page text stays out of the feed',?,?)").run(Date.now(),Date.now());
  sql.prepare("INSERT INTO browser_frames VALUES('frame','visit','coin',0,0,'/9j/2Q==')").run();
  const request=new Request('https://shen.now/api/coins/coin/research');const get=()=>frameGET(request,{params:Promise.resolve({id:'coin',frameId:'frame'})});
  const body=await (await GET(request,{params:Promise.resolve({id:'coin'})})).json();assert.equal(body.browserSessions[0].frames[0].imageUrl,'/api/coins/coin/research/browser/frame');assert.equal(JSON.stringify(body).includes('Full page text'),false);assert.equal(JSON.stringify(body).includes('/9j/2Q=='),false);
  assert.equal((await get()).headers.get('content-type'),'image/jpeg');
  assert.equal((await frameGET(request,{params:Promise.resolve({id:'another',frameId:'frame'})})).status,404);
  sql.exec('UPDATE coins SET token_address=NULL');globalThis.__researchViewer=null;assert.equal((await get()).status,404);
  globalThis.__researchViewer={userId:'owner'};assert.equal((await get()).status,200);
 }finally{sql.close();globalThis.__researchViewer=null;}
});
