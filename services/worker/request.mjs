export class WorkerRequestError extends Error {
  constructor(code){super(code);this.code=code;}
}
export function failureCode(error){
  return error instanceof WorkerRequestError&&/^(HTTP_[1-5]\d{2}|TIMEOUT|NETWORK_ERROR|INVALID_JSON)$/.test(error.code)?error.code:'UNEXPECTED_ERROR';
}
// Log only bounded local codes. Provider bodies/URLs can contain credentials.
export async function serviceRequest(base,path,token,data,siteAccessToken){
  let response;
  try{
    response=await fetch(new URL(path,base),{method:data===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(siteAccessToken?{'OAI-Sites-Authorization':'Bearer '+siteAccessToken}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(180000)});
  }catch(error){throw new WorkerRequestError(error?.name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR');}
  if(!response.ok)throw new WorkerRequestError('HTTP_'+response.status);
  try{return await response.json();}catch{throw new WorkerRequestError('INVALID_JSON');}
}
