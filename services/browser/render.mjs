import { chromium } from 'playwright';
import { publicFetch, publicUrl } from './public-fetch.mjs';

export async function capturePage(url,{executablePath}={}){
  publicUrl(url);
  const browser=await chromium.launch({headless:true,chromiumSandbox:true,...(executablePath?{executablePath}:{}),args:['--disable-background-networking','--disable-extensions']});
  const budget={requests:0,bytes:0,deadline:Date.now()+25000};
  const timer=setTimeout(()=>void browser.close(),30000);
  try{
    const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false,viewport:{width:1200,height:760}});
    await context.route('**/*',async route=>{
      try{
        const request=route.request();
        if(request.method()!=='GET'||!['document','stylesheet','image','font'].includes(request.resourceType()))return await route.abort();
        const result=await publicFetch(request.url(),budget);
        if(result.redirect){publicUrl(result.redirect);await route.fulfill({status:result.status,headers:{location:result.redirect}});return;}
        await route.fulfill({status:result.status,contentType:result.type,body:result.body,headers:{'Content-Security-Policy':"script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"}});
      }catch{await route.abort().catch(()=>{});}
    });
    const page=await context.newPage();
    page.on('dialog',dialog=>void dialog.dismiss());
    const response=await page.goto(url,{waitUntil:'load',timeout:20000});
    if(!response||!response.ok()||!String(response.headers()['content-type']).includes('text/html'))throw Error('Page not available');
    const finalUrl=publicUrl(page.url()).href,title=(await page.title()).slice(0,300);
    const text=(await page.locator('body').innerText({timeout:2000})).replace(/\s+/g,' ').trim().slice(0,8000);
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);
    const frames=[];
    for(const y of [...new Set([0,Math.min(700,Math.max(0,height-760)),Math.min(1400,Math.max(0,height-760))])]){
      await page.evaluate(y=>window.scrollTo(0,y),y);
      const screenshot=await page.screenshot({type:'jpeg',quality:60,timeout:3000});
      if(screenshot.length>500000)throw Error('Capture too large');
      frames.push({scrollY:y,base64:screenshot.toString('base64')});
    }
    return {url:finalUrl,title,text,frames};
  }finally{clearTimeout(timer);await browser.close();}
}
