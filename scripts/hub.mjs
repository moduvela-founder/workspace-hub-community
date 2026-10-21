#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesFingerprint, initializeEntity, loadCatalog } from '../src/lib/hub/core.mjs';
import { resolveAsset, searchAssets } from '../src/lib/hub/index.mjs';
import { listMembers } from '../src/lib/hub/collections.mjs';
import { loadServiceRegistry } from '../src/lib/hub/services.mjs';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [requestedCommand = 'help', ...args] = process.argv.slice(2);
const command = requestedCommand === '--help' ? 'help' : requestedCommand;
function parseOptions(input) {
  const result = {};
  for (let i = 0; i < input.length; i++) {
    const option = input[i];
    if (['--json', '--summary', '--apply', '--help'].includes(option)) result[option.slice(2)] = true;
    else if (['--since', '--path', '--id', '--title', '--kind', '--query'].includes(option)) {
      if (!input[i + 1] || input[i + 1].startsWith('--')) throw new Error(`Missing value for ${option}`);
      result[option.slice(2)] = input[++i];
    } else throw new Error(`Unknown argument: ${option}`);
  }
  return result;
}
try {
  const options = parseOptions(args);
  if (options.summary && requestedCommand !== 'rules') throw new Error('--summary is only supported by rules');
  if (options.help) {
    console.log('Workspace Hub: rules [--summary] [--json] [--since HASH] | catalog | validate | resolve --id ID | search --query TEXT | reference --id ID | members --id ASSET [--query TEXT] | content --id ASSET --query TEXT | init --path ABSOLUTE_PATH --id ID --title TITLE --kind product|tool|framework|workflow|skill|ai|reference [--apply]\nRules --summary omits per-file hashes; it does not replace first-use reading. Resolve accepts a raw ID or workspace-hub:ID, including an optional #MEMBER suffix. Index commands are read-only and need no running web service. Init defaults to dry-run and preserves existing files.');
  } else if (command === 'rules') {
    const result = await rulesFingerprint(base, options.since);
    if (options.json) console.log(JSON.stringify(options.summary ? { fingerprint: result.fingerprint, changed: result.changed } : result, null, 2));
    else {
      console.log(`Rules SHA256: ${result.fingerprint}\n${result.changed ? 'Changed or first check: read relevant rules before acting.' : 'Unchanged: reuse rules only if still retained in this session.'}`);
      if (!options.summary) console.log(result.files.map(file => `${file.sha256}  ${file.path}`).join('\n'));
    }
  } else if (command === 'init') {
    for (const key of ['path', 'id', 'title', 'kind']) if (!options[key]) throw new Error(`Required --${key}`);
    console.log(JSON.stringify(await initializeEntity(base, options), null, 2));
  } else if (['members', 'content'].includes(command)) {
    if (options.apply) throw new Error('--apply is not allowed for read-only index commands');
    if (!options.id) throw new Error('Required --id');
    if (command === 'content' && !options.query) throw new Error('Required --query');
    console.log(JSON.stringify(await listMembers(base, options.id, { query: options.query, mode: command === 'content' ? 'content' : 'metadata' }), null, 2));
  } else if (['resolve', 'reference', 'search'].includes(command)) {
    if (options.apply) throw new Error('--apply is not allowed for read-only index commands');
    const key = command === 'search' ? 'query' : 'id';
    if (!options[key]) throw new Error(`Required --${key}`);
    const result = command === 'search' ? await searchAssets(base, options.query) : await resolveAsset(base, options.id);
    if (command === 'reference' && !options.json) console.log(result.reference);
    else console.log(JSON.stringify(command === 'reference' ? { reference: result.reference } : result, null, 2));
  } else if (['catalog', 'validate'].includes(command)) {
    const result = await loadCatalog(base);
    if (command === 'validate') console.log(JSON.stringify({ valid: true, assets: result.assets.length, repositories: result.repositories.length, services: (await loadServiceRegistry(base)).length, warnings: result.warnings }, null, 2));
    else console.log(JSON.stringify(result, null, 2));
  } else if (command === 'help') {
    console.log('Workspace Hub (local only)\n  rules [--summary] [--json] [--since HASH]\n  catalog [--json]\n  validate\n  resolve --id ID_OR_WORKSPACE_HUB_MARKER[#MEMBER]\n  search --query TEXT\n  reference --id ID[#MEMBER] [--json]\n  members --id ASSET [--query TEXT]\n  content --id ASSET --query TEXT\n  init --path ABSOLUTE_PATH --id ID --title TITLE --kind product|tool|framework|workflow|skill|ai|reference [--apply]\nIndex commands are read-only and independent of the web service. Init defaults to dry-run. Existing files are always preserved.');
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`Hub: ${error.message}`);
  process.exitCode = 1;
}
