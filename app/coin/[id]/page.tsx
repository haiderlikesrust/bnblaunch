import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/server";
import type { Coin } from "@/lib/model";
export const dynamic="force-dynamic";
export default async function CoinSite({params}:{params:Promise<{id:string}>}){const user=await getUser();const row=await db().prepare("SELECT config FROM coins WHERE id=? AND (token_address IS NOT NULL OR owner=?)").bind((await params).id,user?.userId??"").first<{config:string}>();if(!row)notFound();const coin=JSON.parse(row.config) as Coin;if(!coin.site)notFound();return <main style={{maxWidth:850,margin:"70px auto",padding:30}}><a href="/" className="eyebrow">SHEN · 神</a><p className="eyebrow" style={{marginTop:50}}>${coin.symbol} · BNB CHAIN</p><h1 style={{fontSize:"clamp(36px,7vw,60px)"}}>{coin.site.title}</h1><h2>{coin.site.tagline}</h2><p className="detail-copy">{coin.site.about}</p><a className="button secondary" href={`/token/${coin.id}`}>View token and agent</a></main>}
