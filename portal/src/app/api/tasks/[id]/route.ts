import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';

function headers() {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PORTAL_SECRET) h['x-portal-secret'] = process.env.PORTAL_SECRET;
  return h;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(`${OPENCLAW_API}/api/tasks/${id}`, {
      method:  'PATCH',
      headers: headers(),
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const res = await fetch(`${OPENCLAW_API}/api/tasks/${id}`, {
      method:  'DELETE',
      headers: headers(),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return NextResponse.json({ error: `Ghost API ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
