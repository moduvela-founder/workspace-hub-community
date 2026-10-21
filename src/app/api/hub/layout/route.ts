import { NextResponse } from 'next/server';
import { getLayout, saveLayout, LayoutError, MAX_LAYOUT_BYTES } from '../../../../lib/hub/preferences.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

function failure(error: unknown) {
  if (error instanceof LayoutError) return NextResponse.json({ error: error.message, code: error.code, ...(error.layout ? { layout: error.layout } : {}) }, { status: error.status, headers });
  return NextResponse.json({ error: 'Local layout is unavailable.', code: 'LAYOUT_UNAVAILABLE' }, { status: 503, headers });
}

export async function GET() {
  try { return NextResponse.json(await getLayout(process.cwd()), { headers }); }
  catch (error) { return failure(error); }
}

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new LayoutError(400, 'INVALID_LAYOUT', 'JSON body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_LAYOUT_BYTES) {
        await reader.cancel();
        throw new LayoutError(413, 'LAYOUT_TOO_LARGE', 'Layout request exceeds the size limit.');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new LayoutError(400, 'INVALID_JSON', 'A valid UTF-8 JSON body is required.'); }
}

export async function PUT(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'JSON content type is required.', code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415, headers });
  }
  try { return NextResponse.json(await saveLayout(process.cwd(), await body(request)), { headers }); }
  catch (error) { return failure(error); }
}
