import { NextResponse } from 'next/server';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';
const SECRET       = process.env.PORTAL_SECRET ?? '';

export async function GET() {
  try {
    const res = await fetch(`${OPENCLAW_API}/api/health`, {
      headers: { 'x-portal-secret': SECRET },
      signal:  AbortSignal.timeout(8_000),
      cache:   'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'Health check failed' }, { status: 502 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Ghost offline' }, { status: 503 });
  }
}
