const encoder=new TextEncoder();
export function validSecretKey(value){return typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)}
async function key(value){if(!validSecretKey(value))throw Error('Service encryption is not configured');return crypto.subtle.importKey('raw',Uint8Array.from(value.match(/../g),v=>parseInt(v,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function sealServiceSecret(master,coinId,data){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('shen:x:v1:'+coinId)},await key(master),encoder.encode(JSON.stringify(data)));return JSON.stringify({v:1,iv:encode(iv),data:encode(encrypted)});}
export async function openServiceSecret(master,coinId,value){const box=JSON.parse(value);if(box.v!==1)throw Error('Unsupported credential version');const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(box.iv),additionalData:encoder.encode('shen:x:v1:'+coinId)},await key(master),decode(box.data));return JSON.parse(new TextDecoder().decode(raw));}
