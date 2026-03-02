import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const qs = searchParams.toString();
  const path = req.nextUrl.pathname.replace('/api/credits', '');

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PORTAL_SECRET) headers['x-portal-secret'] = process.env.PORTAL_SECRET;

    const res = await fetch(`${OPENCLAW_API}/api/credits${path}${qs ? `?${qs}` : ''}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
      cache:  'no-store',
    });

    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ providers: [], error: 'Ghost offline' });
  }
}
