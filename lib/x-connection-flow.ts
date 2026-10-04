// Shared by the creator's pre-launch step and the existing coin account panel.
export async function openXConnection(coinId:string){
 const r=await fetch('/api/coins/'+encodeURIComponent(coinId)+'/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'connect',consent:true})});
 const value=await r.json() as {url?:string;error?:string};
 if(!r.ok)throw Error(value.error??'Could not start the X connection.');
 const url=new URL(value.url??'');
 if(url.origin!=='https://x.com'||url.pathname!=='/i/oauth2/authorize')throw Error('Invalid X authorization link');
 window.location.assign(url.href);
}
