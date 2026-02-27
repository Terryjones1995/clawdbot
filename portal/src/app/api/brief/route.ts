import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18789';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PORTAL_SECRET) headers['x-portal-secret'] = process.env.PORTAL_SECRET;

    const res = await fetch(`${OPENCLAW_API}/api/scribe/brief`, {
      headers,
      signal: AbortSignal.timeout(15_000),
      cache:  'no-store',
    });

    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ briefing: 'Ghost offline — no briefing available.', ts: new Date().toISOString() });
  }
}
