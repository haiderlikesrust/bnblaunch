import { redirect } from 'next/navigation';
import { coinPath } from '@/lib/coin-links';
export default async function CoinPage({params}:{params:Promise<{id:string}>}) { redirect(coinPath((await params).id)); }
