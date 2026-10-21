#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupShare } from '../src/lib/hub/share.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { console.log('node scripts/setup-share.mjs [--projects-root ABS] [--large-files-root ABS] [--apply]\nPreview by default; apply creates only new local configuration and refuses existing files. Node.js only; no package installation, migration, skill installation or service start.'); process.exit(0); }
    if (arg === '--apply') options.apply = true;
    else if (arg === '--projects-root' || arg === '--large-files-root') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg === '--projects-root' ? 'projectsRoot' : 'largeFilesRoot'] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  console.log(JSON.stringify(await setupShare(base, options), null, 2));
} catch (error) { console.error(`Share setup: ${error.message}`); process.exitCode = 1; }
