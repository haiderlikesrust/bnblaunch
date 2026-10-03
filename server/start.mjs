import {join} from 'node:path';
import {startProdServer} from 'vinext/server/prod-server';
import pg from 'pg';
import {domainHostLookupSql,installHostRouting} from './custom-host-router.mjs';

export async function startShenServer({outDir,port=Number(process.env.PORT??3000),host=process.env.HOST??'0.0.0.0'}={}){
 if(!process.env.APP_ORIGIN||!process.env.DATABASE_URL)throw Error('APP_ORIGIN and DATABASE_URL are required');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be a valid TCP port');
 // The framework binds only to an ephemeral loopback port until the Host boundary is installed.
 const {server}=await startProdServer({port:0,host:'127.0.0.1',outDir:outDir??join(import.meta.dirname,'../../dist'),silent:true});
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:5000});
 pool.on('error',()=>console.error('Custom domain lookup unavailable'));
 await installHostRouting(server,{appOrigin:process.env.APP_ORIGIN,lookupDomain:async domain=>(await pool.query(domainHostLookupSql,[domain])).rows[0]??null});
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
 console.log(`SHEN server listening on ${host}:${port}`);
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{void pool.end();}));
 return {server,pool};
}
