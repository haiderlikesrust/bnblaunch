import { cookies } from 'next/headers';
import { env } from 'cloudflare:workers';
import { getUser } from '@/lib/auth';
import { finishXConnection, X_OAUTH_COOKIE } from '@/lib/social-onboarding';
import { coinPath } from '@/lib/coin-links';

export async function GET(request: Request) {
  let path = '/agents?x=failed';
  try {
    const url = new URL(request.url), user = await getUser();
    if (user) {
      const coinId = await finishXConnection(url.searchParams.get('state') ?? '', (await cookies()).get(X_OAUTH_COOKIE)?.value, user.userId, url.searchParams.get('code'), url.searchParams.has('error'));
      path = coinPath(coinId) + '?x=connected';
    }
  } catch { /* Never reflect provider errors or authorization codes into the URL. */ }
  return new Response(null, { status: 303, headers: { Location: env.APP_ORIGIN ? new URL(path, env.APP_ORIGIN).href : path, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `${X_OAUTH_COOKIE}=; Path=/api/social/x/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}
