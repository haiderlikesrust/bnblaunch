import { z } from "zod";
export const imageInput=z.object({mime:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().min(16).max(2666670).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict();
export function validateImage(input:z.infer<typeof imageInput>){
  const value=imageInput.parse(input),raw=atob(value.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length>2000000||bytes.length<12)throw Error('Choose an image smaller than 2 MB.');
  const valid=(value.mime==='image/png'&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)||(value.mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216)||(value.mime==='image/webp'&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP');
  if(!valid)throw Error('Image contents do not match its file type.');return bytes;
}
