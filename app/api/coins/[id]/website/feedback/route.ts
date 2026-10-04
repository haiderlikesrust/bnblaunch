import { AppError, body, failure, identity, response } from '@/lib/server';
import { feedbackInput, feedbackStatement } from '@/lib/website-feedback';
import { publishedWebsite } from '@/lib/websites';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const viewer=await identity(request),{id}=await params,input=feedbackInput.parse(await body(request,1000));
  const site=await publishedWebsite(id);
  if(!site||input.target!=='home'&&!site.site.pages?.some(p=>p.slug===input.target))throw new AppError(404,'Published page not found.');
  await feedbackStatement(id,viewer,input,Date.now()).run();
  return response({saved:true});
 }catch(error){return failure(error)}
}
