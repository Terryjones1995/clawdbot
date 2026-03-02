import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PORTAL_SECRET) headers['x-portal-secret'] = process.env.PORTAL_SECRET;

    const res = await fetch(`${OPENCLAW_API}/api/forge/fix-one`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000), // fire-and-forget — real data comes via WS
    });

    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
