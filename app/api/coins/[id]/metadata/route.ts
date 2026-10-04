import { env } from "cloudflare:workers";
import { coinUrl } from "@/lib/coin-links";
import { z } from "zod";
import { AppError, body, db, failure, identity, ownedCoin, readBody, remoteJson, response } from "@/lib/server";
import { validateImage } from "@/lib/token-image";
import { metadataCid } from "@/lib/metadata-cid";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const owner=await identity(request),{coin}=await ownedCoin((await params).id,owner);
 if(coin.tokenAddress)throw new AppError(403,"Launched token artwork is permanent.");
 let file:File,authorizationId:string;
 if(request.headers.get('content-type')?.includes('application/json')){
  ({authorizationId}=z.object({useSavedImage:z.literal(true),authorizationId:z.string().uuid()}).strict().parse(await body(request)));
  const saved=await db().prepare("SELECT mime,base64 FROM coin_images WHERE coin_id=?").bind(coin.id).first<{mime:'image/png'|'image/jpeg'|'image/webp';base64:string}>();
  if(!saved)throw new AppError(400,"Upload a token image first.");
  const bytes=validateImage(saved);
  file=new File([bytes],`token.${saved.mime.split('/')[1]}`,{type:saved.mime});
 }else{
  if(coin.imageUrl)throw new AppError(400,"Use the image saved with this launch plan.");
  // Bound the stream before multipart parsing, including chunked requests that
  // omit Content-Length. Per-file validation alone happens after allocation.
  const bytes=await readBody(request,2200000);
  let form:FormData;try{form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData()}catch{throw new AppError(400,"Invalid image upload");}
  authorizationId=z.string().uuid().parse(form.get("authorizationId")??undefined);
  const value=form.get("image");
  if(!(value instanceof File)||value.size>2000000||value.size<12||!["image/png","image/jpeg","image/webp"].includes(value.type))throw new AppError(400,"Use a PNG, JPEG or WebP smaller than 2 MB");
  const b=new Uint8Array(await value.slice(0,12).arrayBuffer());
  const valid=(value.type==="image/png"&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)||(value.type==="image/jpeg"&&b[0]===255&&b[1]===216)||(value.type==="image/webp"&&String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP");
  if(!valid)throw new AppError(400,"Image contents do not match its file type");
  file=value;
 }
 // Pinning requires a live authorization, and its CID is bound to that plan.
 const auth=await db().prepare("SELECT tweet_url,expires_at FROM launch_authorizations WHERE id=? AND coin_id=? AND creator=? AND used_at IS NULL").bind(authorizationId,coin.id,owner.toLowerCase()).first<{tweet_url:string;expires_at:number}>();
 if(!auth||auth.expires_at<Date.now())throw new AppError(409,"Launch authorization expired. Validate the launch again.");
 const tweetUrl=auth.tweet_url||null;
 const data=new FormData();
 data.append("operations",JSON.stringify({query:"mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }",variables:{file:null,meta:{website:coinUrl(env.APP_ORIGIN||new URL(request.url).origin,coin.id),twitter:tweetUrl,telegram:null,description:coin.description,creator:owner}}}));
 data.append("map",JSON.stringify({"0":["variables.file"]}));data.append("0",file);
 const result=await remoteJson<{data?:{create:string};errors?:unknown[]}>("https://funcs.flap.sh/api/upload",{method:"POST",body:data});
 if(result.errors||!result.data?.create)throw new AppError(502,"Flap metadata upload failed");
 const cid=metadataCid.safeParse(result.data.create);
 if(!cid.success)throw new AppError(502,"Flap returned an invalid metadata identifier. Please retry the upload.");
 const bound=await db().prepare("UPDATE launch_authorizations SET metadata_cid=? WHERE id=? AND coin_id=? AND used_at IS NULL").bind(cid.data,authorizationId,coin.id).run();
 if(!bound.meta.changes)throw new AppError(409,"Launch authorization expired. Validate the launch again.");
 return response({cid:cid.data})
}catch(e){return failure(e)}}
