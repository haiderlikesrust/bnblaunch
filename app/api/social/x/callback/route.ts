import { cookies } from 'next/headers';
import { env } from 'cloudflare:workers';
import { getUser } from '@/lib/auth';
import { finishXConnection, xConnectionCoin, X_OAUTH_COOKIE } from '@/lib/social-onboarding';
import { XConnectionError } from '@/lib/x-connection-result';
import { coinPath } from '@/lib/coin-links';

export async function GET(request: Request) {
  let target='/agents',path='/agents?x=failed&x_error=session_required';
  try {
    const url = new URL(request.url), user = await getUser();
    if (user) {
      const state=url.searchParams.get('state')??'',cookie=(await cookies()).get(X_OAUTH_COOKIE)?.value;
      const returnCoin=await xConnectionCoin(state,cookie,user.userId);
      if(returnCoin)target=coinPath(returnCoin);
      const coinId = await finishXConnection(state,cookie, user.userId, url.searchParams.get('code'), url.searchParams.has('error'));
      path = coinPath(coinId) + '?x=connected';
    }
  } catch(error) {
    const code=error instanceof XConnectionError?error.code:'server_error';
    console.warn('[SHEN X connection]',code);
    path=target+'?x=failed&x_error='+code;
  }
  return new Response(null, { status: 303, headers: { Location: env.APP_ORIGIN ? new URL(path, env.APP_ORIGIN).href : path, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `${X_OAUTH_COOKIE}=; Path=/api/social/x/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}
