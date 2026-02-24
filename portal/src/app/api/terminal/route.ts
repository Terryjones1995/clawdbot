import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18789';

export async function POST(req: NextRequest) {
  // Auth guard
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { message: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }

  // Forward to Ghost reception endpoint
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PORTAL_SECRET) headers['x-portal-secret'] = process.env.PORTAL_SECRET;

    const res = await fetch(`${OPENCLAW_API}/api/reception`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        message:   message.trim(),
        userId:    (session.user as any)?.id ?? 'portal-user',
        username:  session.user?.name ?? 'Portal',
        source:    'portal-terminal',
        channelId: 'terminal',
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'no body');
      return NextResponse.json(
        { error: `Ghost API returned ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => ({ reply: '(no response body)' }));
    return NextResponse.json({ reply: data.reply ?? data.message ?? JSON.stringify(data) });

  } catch (err: any) {
    // Ghost backend may be offline
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return NextResponse.json({ error: 'Ghost gateway timed out after 60s' }, { status: 504 });
    }
    if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      return NextResponse.json({
        reply: '⚠ Ghost system is offline. Start it with: npm run pm2:restart',
      });
    }
    console.error('[terminal] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
