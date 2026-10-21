import { NextResponse } from 'next/server';
import { parseAssetReference, resolveAsset } from '../../../../lib/hub/index.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  try { parseAssetReference(id); } catch {
    return NextResponse.json({ error: 'A valid asset id is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    return NextResponse.json(await resolveAsset(process.cwd(), id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && ['ASSET_NOT_FOUND', 'MEMBER_NOT_FOUND', 'COLLECTION_NOT_FOUND'].includes(String(error.code));
    return NextResponse.json({ error: missing ? 'Asset does not exist.' : 'Asset index invalid or unavailable. Run node scripts/hub.mjs validate locally.' }, { status: missing ? 404 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
