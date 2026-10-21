#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportShare } from '../src/lib/hub/share.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { console.log('node scripts/export-share.mjs [--output-dir ABS] [--redact-account NAME ...]\nExport requires Node.js and python3 (standard-library ZIP only). Recipients need Node.js for setup, not Python. Defaults to ignored .local/artifacts/share; existing outputs are never overwritten. Personal global/workspace rules are never read; only the tracked merge suggestion is included. Source private values are redacted in exported copies; origin owner is inferred when available.'); process.exit(0); }
    const key = { '--output-dir': 'outputDirectory', '--redact-account': 'privateAccounts' }[arg];
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (key === 'privateAccounts') (options.privateAccounts ??= []).push(value);
    else options[key] = value;
  }
  console.log(JSON.stringify(await exportShare(base, options), null, 2));
} catch (error) { console.error(`Share export: ${error.message}`); process.exitCode = 1; }
