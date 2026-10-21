#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listServices, controlService, ServiceError } from '../src/lib/hub/services.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
try {
  const action = args.shift() ?? 'status';
  if (!['status', 'start', 'stop'].includes(action)) throw new Error('Usage: node scripts/hub-services.mjs status|start|stop [--id ID] [--json]');
  let id;
  while (args.length) {
    const argument = args.shift();
    if (argument === '--json') continue;
    if (argument === '--id' && !id && args[0] && !args[0].startsWith('--')) id = args.shift();
    else throw new Error('Usage: node scripts/hub-services.mjs status|start|stop [--id ID] [--json]');
  }
  if (action !== 'status' && !id) throw new Error('A registered service ID is required for start or stop.');
  const result = action === 'status' ? await listServices(base) : await controlService(base, id, action);
  if (id) {
    const service = result.services.find(item => item.id === id);
    if (!service) throw new ServiceError(404, 'SERVICE_NOT_FOUND', 'The requested service is not registered.');
    result.services = [service];
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const safe = error instanceof ServiceError ? { error: error.message, code: error.code } : { error: 'Local service command or configuration is unavailable.', code: 'SERVICES_UNAVAILABLE' };
  console.error(JSON.stringify(safe));
  process.exitCode = 1;
}
