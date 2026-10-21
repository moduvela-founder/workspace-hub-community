import { NextResponse } from 'next/server';
import { loadCatalog } from '../../../../lib/hub/core.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const catalog = await loadCatalog(process.cwd());
    return NextResponse.json(catalog, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Do not send filesystem errors or document contents to the browser.
    return NextResponse.json({ error: 'Catalogue invalid or unavailable. Run node scripts/hub.mjs validate locally.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
