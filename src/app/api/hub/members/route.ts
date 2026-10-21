import { NextResponse } from 'next/server';
import { collectionInfo, listMembers } from '../../../../lib/hub/collections.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const mode = params.get('mode') || 'metadata';
  const query = params.get('query') || undefined;
  if (!id || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id) || !['info', 'metadata', 'content'].includes(mode) || (query !== undefined && (!query.trim() || query.length > 200 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(query))) || (mode === 'content' && !query)) {
    return NextResponse.json({ error: 'Invalid collection query.' }, { status: 400, headers });
  }
  try {
    if (mode === 'info') return NextResponse.json({ collection: await collectionInfo(process.cwd(), id), readOnly: true }, { headers });
    return NextResponse.json(await listMembers(process.cwd(), id, { query, mode: mode as 'metadata' | 'content' }), { headers });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    const missing = ['COLLECTION_NOT_FOUND', 'ASSET_NOT_FOUND'].includes(code);
    return NextResponse.json({ error: missing ? 'Collection is not registered.' : 'Collection unavailable; check its local configuration.' }, { status: missing ? 404 : 503, headers });
  }
}
