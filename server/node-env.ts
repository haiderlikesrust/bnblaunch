import { nodeDatabase } from "./postgres.mjs";
export const env=new Proxy({} as Cloudflare.Env,{
  get(_target,key){if(key==="DB")return nodeDatabase() as unknown as D1Database;return process.env[String(key)];},
});
