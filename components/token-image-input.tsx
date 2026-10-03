"use client";
import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { validateImage } from "@/lib/token-image";
import type { T } from "@/lib/ui";
export type TokenImage={mime:'image/png'|'image/jpeg'|'image/webp';base64:string};
export default function TokenImageInput({value,onChange,t}:{value:TokenImage|null;onChange:(v:TokenImage|null)=>void;t:T}){
  const input=useRef<HTMLInputElement>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function select(file?:File){if(!file)return;setError('');setBusy(true);try{
    if(file.size>2000000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error(t('请选择小于 2 MB 的 PNG、JPEG 或 WebP 图片。','Choose a PNG, JPEG or WebP image under 2 MB.'));
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Could not read image.'));reader.readAsDataURL(file)});
    const next={mime:file.type as TokenImage['mime'],base64:data.split(',')[1]};validateImage(next);
    const image=new Image();image.src=data;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('Image could not be decoded.');
    onChange(next);
  }catch(e){setError((e as Error).message)}finally{setBusy(false);if(input.current)input.current.value=''}}
  return <div className="form-field span-two"><label htmlFor="token-image">{t('代币图片','Token image')}</label><div className="token-image-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void select(e.dataTransfer.files[0])}}>
    <div className="token-image-thumb">{value?<img src={`data:${value.mime};base64,${value.base64}`} alt={t('代币图片预览','Token image preview')}/>:<Upload size={25}/>}</div>
    <div><strong>{value?t('图片已准备好','Image ready'):t('给你的代币一个面孔','Give your token a face')}</strong><p>{t('PNG、JPEG 或 WebP · 最大 2 MB','PNG, JPEG or WebP · max 2 MB')}</p><label className="button secondary image-file-button" htmlFor="token-image">{busy?t('读取中…','Reading…'):value?t('更换图片','Change image'):t('上传图片','Upload image')}</label></div>
    <input ref={input} id="token-image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>void select(e.target.files?.[0])}/>
    {value&&<button type="button" className="image-remove" aria-label={t('移除图片','Remove image')} onClick={()=>onChange(null)}><X size={17}/></button>}
  </div>{error&&<small role="alert" className="form-error">{error}</small>}</div>;
}
