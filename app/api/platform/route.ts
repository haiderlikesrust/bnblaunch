import { env } from 'cloudflare:workers';
import { getAddress, isAddress, zeroAddress } from 'viem';

export function GET() {
  const address = env.SHEN_TOKEN_ADDRESS?.trim();
  return Response.json({
    shenTokenAddress: address && isAddress(address) && address.toLowerCase() !== zeroAddress ? getAddress(address) : null,
    xUrl: 'https://x.com/shendotnow',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
