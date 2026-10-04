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
  assert.deepEqual(await platformGET().json(),{shenTokenAddress:env.SHEN_TOKEN_ADDRESS,xUrl:'https://x.com/shendotnow'});
 }finally{delete env.SHEN_TOKEN_ADDRESS;delete env.OPENROUTER_API_KEY;}
});
