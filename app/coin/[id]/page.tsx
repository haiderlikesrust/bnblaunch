import { notFound, redirect } from 'next/navigation';
import { publishedWebsite } from '@/lib/websites';
export const dynamic='force-dynamic';
export default async function CoinSite({params}:{params:Promise<{id:string}>}){
 const published=await publishedWebsite((await params).id);
 if(!published)notFound();
 redirect(published.site.url);
}
