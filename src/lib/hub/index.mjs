import fs from 'node:fs/promises';
import path from 'node:path';
import { guardedPath, loadCatalog, loadConfig } from './core.mjs';
import { formatReference, formatMemberReference } from './reference.mjs';
import { collectionInfo, resolveMember } from './collections.mjs';
import { loadServiceRegistry } from './services.mjs';

const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const INSTRUCTION_SCOPE_NOTE = 'Potentially applicable owning-scope instructions; read those relevant to the selected source and intended action before acting. Reference lookup alone does not require every listed file or authorize execution.';
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
function indexError(code, message) { return Object.assign(new Error(message), { code }); }

export function parseAssetReference(reference) {
  if (typeof reference === 'string' && reference.startsWith('workspace-hub:')) reference = reference.slice('workspace-hub:'.length);
  if (typeof reference !== 'string') throw indexError('INVALID_ASSET_ID', 'Invalid asset ID');
  const [id, memberId, extra] = reference.split('#');
  if (!ID.test(id) || extra !== undefined || (memberId !== undefined && (memberId.length > 240 || !memberId.split('/').every(part => /^[a-z0-9][a-z0-9._-]*$/.test(part) && part !== '.' && part !== '..')))) throw indexError('INVALID_ASSET_ID', 'Invalid asset or member reference');
  return { id, memberId };
}

async function context(base) {
  return { base: await fs.realpath(base), catalog: await loadCatalog(base), config: await loadConfig(base), services: await loadServiceRegistry(base) };
}

// Revalidate even pointers that loadCatalog retained with a warning. No source
// document contents, Git processes or project commands are accessed here.
async function localPointer(pointer, config) {
  if (!pointer) return null;
  try { return await guardedPath(pointer, config.roots, { allowMissing: true }); }
  catch { return null; }
}

async function instructionsFor(ownerPath, config) {
  if (!ownerPath) return [];
  const roots = config.roots.filter(root => inside(root, ownerPath));
  if (!roots.length) return [];
  // Include workspace rules as well as the most specific asset instructions.
  const boundary = roots.sort((a, b) => a.length - b.length)[0];
  let directory = ownerPath;
  try { if (!(await fs.stat(directory)).isDirectory()) directory = path.dirname(directory); }
  catch { /* Missing owner directories can still have existing ancestor rules. */ }
  const found = [];
  while (inside(boundary, directory)) {
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      try {
        const candidate = await guardedPath(path.join(directory, name), config.roots);
        if ((await fs.stat(candidate)).isFile()) { found.push(candidate); break; }
      } catch { /* Missing, excluded and escaped pointers are not published. */ }
    }
    if (directory === boundary) break;
    directory = path.dirname(directory);
  }
  return [...new Set(found.reverse())];
}

async function assetPointer(asset, config) {
  return {
    id: asset.id, title: asset.title, kind: asset.kind, workspace: asset.workspace,
    ownerPath: await localPointer(asset.ownerPath, config),
    entrypoint: await localPointer(asset.entrypoint, config),
    statusFile: await localPointer(asset.statusFile, config),
    manualStepsFile: await localPointer(asset.manualStepsFile, config),
  };
}

async function resolveFrom(ctx, asset) {
  const { config, catalog } = ctx;
  const pointer = await assetPointer(asset, config);
  const repositories = [];
  for (const id of asset.repositoryIds) {
    const repo = catalog.repositories.find(item => item.id === id);
    const repoPath = await localPointer(repo.path, config);
    if (!repoPath) continue;
    const checkouts = [];
    for (const checkout of repo.checkouts) {
      const checkoutPath = await localPointer(checkout.path, config);
      if (checkoutPath) checkouts.push({ path: checkoutPath, role: checkout.role });
    }
    repositories.push({ id: repo.id, title: repo.title, path: repoPath, checkouts, ...(repo.remoteHint ? { remoteHint: repo.remoteHint } : {}) });
  }
  const capabilities = [];
  for (const id of asset.uses) capabilities.push(await assetPointer(catalog.assets.find(item => item.id === id), config));
  const sources = [];
  for (const source of asset.sources) {
    if (!source.path) continue;
    const pointerPath = /^https?:\/\//i.test(source.path) ? source.path : await localPointer(source.path, config);
    if (pointerPath) sources.push({ path: pointerPath, note: source.note, ...(source.checkedAt ? { checkedAt: source.checkedAt } : {}) });
  }
  const instructionPaths = new Set(await instructionsFor(pointer.ownerPath, config));
  for (const instruction of await instructionsFor(pointer.entrypoint, config)) instructionPaths.add(instruction);
  for (const related of [...repositories.map(repo => ({ ownerPath: repo.path })), ...capabilities]) {
    for (const instruction of await instructionsFor(related.ownerPath, config)) instructionPaths.add(instruction);
  }
  const servicePointers = [];
  for (const service of ctx.services.filter(service => service.assetIds.some(id => id === asset.id || asset.uses.includes(id)))) {
    const guide = await guardedPath(path.join(ctx.base, service.guide), [ctx.base]);
    servicePointers.push({
      id: service.id, title: service.title, assetIds: service.assetIds, transport: service.transport, guide,
      statusCommand: { command: 'node', args: [path.join(ctx.base, 'scripts/hub-services.mjs'), 'status', '--id', service.id] },
    });
  }
  return {
    schemaVersion: 1, asset: pointer, repositories, capabilities, sources,
    services: servicePointers,
    collection: await collectionInfo(ctx.base, asset.id),
    instructions: [...instructionPaths].map(file => ({ path: file, note: INSTRUCTION_SCOPE_NOTE })),
    reference: formatReference(asset, ctx.base), rulesFingerprint: catalog.rulesFingerprint,
    warnings: asset.warnings,
    readOnly: true,
  };
}

export async function resolveAsset(base, id) {
  const reference = parseAssetReference(id);
  id = reference.id;
  const ctx = await context(base);
  const asset = ctx.catalog.assets.find(item => item.id === id);
  if (!asset) throw indexError('ASSET_NOT_FOUND', `Asset does not exist: ${id}`);
  const result = await resolveFrom(ctx, asset);
  if (reference.memberId !== undefined) {
    const selected = await resolveMember(base, id, reference.memberId);
    result.member = selected.member;
    result.reference = formatMemberReference(asset, selected.member, ctx.base);
    result.sources.push({ path: selected.member.path, note: 'Selected collection member; read its original file for this task.' });
    for (const instruction of await instructionsFor(path.dirname(selected.member.path), ctx.config)) {
      if (!result.instructions.some(item => item.path === instruction)) result.instructions.push({ path: instruction, note: INSTRUCTION_SCOPE_NOTE });
    }
    result.warnings.push(...selected.warnings);
  }
  return result;
}

export async function searchAssets(base, query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw indexError('INVALID_QUERY', 'Query must contain 1–200 characters');
  const ctx = await context(base);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const matches = ctx.catalog.assets.filter(asset => {
    const repos = ctx.catalog.repositories.filter(repo => asset.repositoryIds.includes(repo.id));
    const searchable = [asset.id, asset.title, asset.kind, asset.workspace, asset.summary, asset.goal ?? '', ...asset.tags, ...repos.flatMap(repo => [repo.id, repo.title])].join('\n').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
  const results = [];
  for (const asset of matches) results.push(await resolveFrom(ctx, asset));
  return { schemaVersion: 1, query: query.trim(), total: results.length, results, readOnly: true };
}
