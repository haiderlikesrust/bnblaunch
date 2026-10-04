import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, migratePostgres, postgresSql } from '../server/postgres.mjs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

test('SQL conversion preserves literal question marks and public field names',()=>{
  assert.equal(postgresSql("SELECT '?' AS literal, created_at AS createdAt FROM coins WHERE id=?"),"SELECT '?' AS literal, created_at AS \"createdAt\" FROM coins WHERE id=$1");
  assert.equal(postgresSql("SELECT created_at as createdAt FROM coins"),'SELECT created_at AS "createdAt" FROM coins');
  assert.match(postgresSql("SELECT json_extract(config,'$.state'),unixepoch()*1000 FROM coins WHERE id=?"),/config::jsonb/);
});
test('all migrations and transactional reservations run on PostgreSQL',async()=>{
  const pg=new PGlite();await pg.waitReady;
  const client={query:async(sql,params)=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length}},release(){}};
  // PGlite runs PostgreSQL's actual parser, constraints, and transaction engine.
  // Migration files contain multiple statements, so execute them as a script.
  const migrationClient={query:(sql,params)=>params?pg.query(sql,params):pg.exec(sql).then(r=>r[0]??{rows:[]})};
  try{
    await migratePostgres(migrationClient,resolve('drizzle'));await migratePostgres(migrationClient,resolve('drizzle'));
    const db=createDatabase({connect:async()=>client});
    await db.prepare("INSERT INTO coins(id,owner,config,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?)").bind('coin','owner',JSON.stringify({name:'Test',state:'active'}),'2026-10-03','2026-10-03',100).run();
    await pg.exec(postgresSql(readFileSync('drizzle/0023_testing_activation_threshold.sql','utf8')));
    assert.deepEqual(JSON.parse((await db.prepare("SELECT config FROM coins WHERE id='coin'").first()).config),{name:'Test',state:'active',threshold:0.01});
    const reserve=async(id)=>db.batch([
      db.prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,id,'plan','reserved',70,'2026-10-03' FROM coins WHERE id='coin' AND ai_credit_microusd>=70").bind(id),
      db.prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-70 WHERE id='coin' AND EXISTS(SELECT 1 FROM agent_runs WHERE id=?)").bind(id),
    ]);
    assert.equal((await reserve('first'))[0].meta.changes,1);assert.equal((await reserve('second'))[0].meta.changes,0);
    assert.equal((await db.prepare("SELECT ai_credit_microusd FROM coins WHERE id='coin'").first()).ai_credit_microusd,30);
    const row=await db.prepare("SELECT created_at AS createdAt,json_extract(config,'$.name') AS name FROM coins WHERE id=?").bind('coin').first();assert.equal(row.createdAt,'2026-10-03');assert.equal(row.name,'Test');
    assert.equal((await db.prepare("SELECT created_at as createdAt FROM coins WHERE id=?").bind('coin').first()).createdAt,'2026-10-03');
    await assert.rejects(db.batch([db.prepare("UPDATE coins SET ai_credit_microusd=0 WHERE id='coin'"),db.prepare("INSERT INTO coins(id) VALUES('coin')")]));
    assert.equal((await db.prepare("SELECT ai_credit_microusd FROM coins WHERE id='coin'").first()).ai_credit_microusd,30);
    const count=await db.prepare("SELECT COUNT(*) AS count FROM wallet_sessions").first();assert.equal(Number(count.count),0);
    const gate=await db.prepare("INSERT INTO provider_limits(id,next_at) VALUES('test',?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE provider_limits.next_at<=? RETURNING id").bind(Date.now()+15000,Date.now()).first();assert.equal(gate.id,'test');
  }finally{await pg.close()}
});
