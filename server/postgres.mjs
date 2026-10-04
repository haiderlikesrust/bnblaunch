import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// The application uses a small prepared-statement interface in both runtimes.
// PostgreSQL executes all writes at SERIALIZABLE isolation with bounded retry.
export function postgresSql(sql){
  let parameter=0,quoted=false,out='';
  for(let i=0;i<sql.length;i++){
    const ch=sql[i];
    if(ch==="'"){out+=ch;if(quoted&&sql[i+1]==="'"){out+=sql[++i];continue}quoted=!quoted;continue;}
    out+=ch==='?'&&!quoted?'$'+(++parameter):ch;
  }
  return out.replace(/`([^`]+)`/g,'"$1"')
    .replace(/json_set\((\w+),\s*'\$\.(\w+)',\s*(\d+(?:\.\d+)?)\)/g,"jsonb_set($1::jsonb, '{$2}', '$3'::jsonb)::text")
    .replace(/json_extract\((\w+(?:\.\w+)?),\s*'\$\.(\w+)'\)/g,"($1::jsonb ->> '$2')")
    .replace(/unixepoch\(\)\*1000/g,'(floor(extract(epoch from clock_timestamp())*1000)::bigint)')
    .replace(/\b[Aa][Ss]\s+([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g,'AS "$1"');
}
const safeNumber=v=>{const n=Number(v);if(!Number.isSafeInteger(n))throw Error('Database integer exceeds supported precision');return n;};
pg.types.setTypeParser(20,safeNumber);
pg.types.setTypeParser(1700,v=>{const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw Error('Database number exceeds supported precision');return n;});
export async function migratePostgres(client,directory){
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(734536561)');
    await client.query('CREATE TABLE IF NOT EXISTS shen_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for(const name of (await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n)).sort()){
      if((await client.query('SELECT name FROM shen_migrations WHERE name=$1',[name])).rows.length)continue;
      // Migrations contain portable relational DDL. Epochs and USD micro-units
      // need PostgreSQL bigint rather than its 32-bit integer.
      const sql=postgresSql(await readFile(resolve(directory,name),'utf8')).replace(/\binteger\b/gi,'bigint');
      await client.query(sql);await client.query('INSERT INTO shen_migrations(name) VALUES($1)',[name]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
}
export function createDatabase(pool,ready=Promise.resolve()){
  async function transaction(statements){
    await ready;
    for(let attempt=0;attempt<4;attempt++){
      const client=await pool.connect();
      try{
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const results=[];
        for(const statement of statements){const r=await client.query(postgresSql(statement.sql),statement.values);results.push({success:true,results:r.rows,meta:{changes:r.rowCount??0}});}
        await client.query('COMMIT');return results;
      }catch(e){await client.query('ROLLBACK');if(!['40001','40P01'].includes(e.code)||attempt===3)throw e;}
      finally{client.release();}
    }
    throw Error('Database is busy');
  }
  function prepare(sql,values=[]){
    const statement={sql,values,bind(...args){return prepare(sql,args)},async all(){return (await transaction([statement]))[0]},async run(){return (await transaction([statement]))[0]},async first(column){const r=(await transaction([statement]))[0].results[0];return column?(r?.[column]??null):(r??null)}};
    return statement;
  }
  return {prepare,batch:transaction};
}
let singleton;
export function nodeDatabase(){
  if(singleton)return singleton;
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,statement_timeout:20000});
  pool.on('error',()=>console.error('PostgreSQL connection unavailable'));
  const ready=(async()=>{const client=await pool.connect();try{await migratePostgres(client,resolve(process.env.MIGRATIONS_DIR??'drizzle'));}finally{client.release()}})();
  ready.catch(()=>console.error('PostgreSQL migration failed; application writes are disabled'));
  singleton=createDatabase(pool,ready);return singleton;
}
