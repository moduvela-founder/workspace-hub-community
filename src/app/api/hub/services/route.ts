import { NextResponse } from 'next/server';
import { listServices, controlService, validateServiceRequest, ServiceError, MAX_SERVICE_REQUEST_BYTES } from '../../../../lib/hub/services.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
function failure(error: unknown) {
  if (error instanceof ServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  return NextResponse.json({ error: 'Local services are unavailable.', code: 'SERVICES_UNAVAILABLE' }, { status: 503, headers });
}
export async function GET() {
  try { return NextResponse.json(await listServices(process.cwd()), { headers }); }
  catch (error) { return failure(error); }
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError(400, 'INVALID_JSON', 'A JSON body is required.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_SERVICE_REQUEST_BYTES) { await reader.cancel(); throw new ServiceError(413, 'SERVICE_REQUEST_TOO_LARGE', 'Service request exceeds the size limit.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ServiceError(400, 'INVALID_JSON', 'A valid UTF-8 JSON body is required.'); }
}
export async function POST(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'JSON content type is required.', code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415, headers });
  }
  try {
    const payload = validateServiceRequest(await body(request));
    return NextResponse.json(await controlService(process.cwd(), payload.id, payload.action), { headers });
  } catch (error) { return failure(error); }
}
