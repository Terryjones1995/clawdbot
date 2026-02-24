import { NextResponse } from 'next/server';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18789';

export async function GET() {
  try {
    const res = await fetch(`${OPENCLAW_API}/api/heartbeat`, {
      signal: AbortSignal.timeout(5_000),
      cache:  'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'Ghost offline' }, { status: 502 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Ghost offline' }, { status: 503 });
  }
}
