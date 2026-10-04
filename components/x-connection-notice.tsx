"use client";
import {useEffect,useState} from 'react';
import {X_CONNECTION_ERRORS,xConnectionCode,type XConnectionCode} from '@/lib/x-connection-result';
import type {T} from '@/lib/ui';

export default function XConnectionNotice({page,coinId,t}:{page:string;coinId?:string;t:T}){
 const [code,setCode]=useState<XConnectionCode|null>(null);
 useEffect(()=>{const query=new URLSearchParams(window.location.search);setCode(['token','agents'].includes(page)&&query.get('x')==='failed'?xConnectionCode(query.get('x_error')):null)},[page,coinId]);
 if(!code)return null;
 const message=X_CONNECTION_ERRORS[code];
 return <div className="form-error" role="alert" style={{marginBottom:24}}><strong>{t('X 账号未连接','X account not connected')}</strong><p>{t(message[0],message[1])}</p><small>{t('连接代码','Connection code')}: {code}</small></div>;
}
