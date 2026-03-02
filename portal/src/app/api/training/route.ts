import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';

function headers() {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PORTAL_SECRET) h['x-portal-secret'] = process.env.PORTAL_SECRET;
  return h;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const qs = req.nextUrl.searchParams.toString();

  try {
    const res = await fetch(`${OPENCLAW_API}/api/training${qs ? `?${qs}` : ''}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
      cache:  'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ entries: [], total: 0, error: 'Ghost offline' });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const res = await fetch(`${OPENCLAW_API}/api/training`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
