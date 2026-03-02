import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ids = req.nextUrl.searchParams.get('ids') ?? '';
  if (!ids) return NextResponse.json({ users: {} });

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PORTAL_SECRET) headers['x-portal-secret'] = process.env.PORTAL_SECRET;

    const res = await fetch(`${OPENCLAW_API}/api/discord/users?ids=${encodeURIComponent(ids)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache:  'no-store',
    });

    if (!res.ok) return NextResponse.json({ users: {} }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ users: {} });
  }
}
