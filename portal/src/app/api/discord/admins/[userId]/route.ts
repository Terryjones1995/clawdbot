import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const OPENCLAW_API = process.env.OPENCLAW_API_URL ?? 'http://localhost:18790';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await params;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PORTAL_SECRET) headers['x-portal-secret'] = process.env.PORTAL_SECRET;

  try {
    const res = await fetch(`${OPENCLAW_API}/api/discord/admins/${userId}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Ghost offline' }, { status: 502 });
  }
}
