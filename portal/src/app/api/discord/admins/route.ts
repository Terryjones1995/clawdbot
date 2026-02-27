import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18789';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PORTAL_SECRET) h['x-portal-secret'] = process.env.PORTAL_SECRET;
  return h;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const res = await fetch(`${OPENCLAW_API}/api/discord/admins`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ admins: [], error: 'Ghost offline' });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const res = await fetch(`${OPENCLAW_API}/api/discord/admins`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Ghost offline' }, { status: 502 });
  }
}
