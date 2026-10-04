import { db, response, failure, AppError } from '@/lib/server';
import { browserHistory } from '@/lib/browser-research';
import { getUser } from '@/lib/auth';
import { researchHistory } from '@/lib/research-history';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Launched coins are public; only the owner may inspect an unlaunched plan.
    let coin = await db().prepare('SELECT id FROM coins WHERE id=? AND token_address IS NOT NULL').bind(id).first();
    if (!coin) {
      const user = await getUser();
      if (user) coin = await db().prepare('SELECT id FROM coins WHERE id=? AND owner=?').bind(id, user.userId).first();
    }
    if (!coin) throw new AppError(404, 'Coin not found.');
    const [searches,browserSessions]=await Promise.all([researchHistory(id),browserHistory(id)]);
    return response({searches,browserSessions});
  } catch (error) { return failure(error); }
}
