import { env } from 'cloudflare:workers';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { influencerConfigured } from '@/lib/influencer-runtime';
import { influencerRates } from '@/lib/influencer-policy';

export function GET() {
  const address = env.SHEN_TOKEN_ADDRESS?.trim(), rates = influencerRates();
  return Response.json({
    shenTokenAddress: address && isAddress(address) && address.toLowerCase() !== zeroAddress ? getAddress(address) : null,
    xUrl: 'https://x.com/shendotnow',
    influencer: { available: influencerConfigured(), dailyPosts: rates?.dailyPosts ?? 6, videos: !!rates && rates.video > 0 && rates.videoPercent > 0 },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
