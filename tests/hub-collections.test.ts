import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { collectionInfo, listMembers, resolveMember } from '../src/lib/hub/collections.mjs';

let base: string;
let root: string;
let owner: string;
let registration: Record<string, any>;
async function save() {
  await fs.writeFile(path.join(base, 'catalog/collections.json'), JSON.stringify({ schemaVersion: 1, collections: [registration] }));
}
async function write(relative: string, content: string) {
  const file = path.join(owner, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hub-collections-')));
  root = path.join(base, 'workspace');
  owner = path.join(root, 'roles');
  await fs.mkdir(path.join(owner, 'engineering'), { recursive: true });
  await fs.mkdir(path.join(base, 'catalog'));
  await fs.writeFile(path.join(base, 'hub.config.json'), JSON.stringify({ schemaVersion: 1, roots: [root] }));
  await fs.writeFile(path.join(base, 'catalog/assets.json'), JSON.stringify({ schemaVersion: 1, repositories: [], assets: [{ id: 'roles', kind: 'skill', title: 'Roles', workspace: 'test', summary: 'Role collection', stage: 'delivered', tags: [], repositoryIds: [], uses: [], sources: [], ownerPath: owner }] }));
  registration = { assetId: 'roles', rootRelative: '.', include: ['engineering'], kind: 'role', metadata: 'frontmatter' };
  await save();
});
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('bounded read-only collection index', () => {
  it('lists explicit metadata, hashes actual file bytes, and preserves registry and source files', async () => {
    const content = '---\nname: Embedded Firmware Engineer\ndescription: ARM firmware specialist\n---\n# Role\nBODY_SECRET_NOT_METADATA\n';
    const file = await write('engineering/Embedded.md', content);
    await write('marketing/outside.md', '---\nname: Hidden\ndescription: Not whitelisted\n---');
    const before = await fs.readFile(path.join(base, 'catalog/collections.json'), 'utf8');
    const result = await listMembers(base, 'workspace-hub:roles');
    expect(result).toMatchObject({ total: 1, matched: 1, readOnly: true });
    expect(result.members[0]).toEqual({ id: 'engineering/embedded', title: 'Embedded Firmware Engineer', description: 'ARM firmware specialist', group: 'engineering', kind: 'role', path: file, sha256: crypto.createHash('sha256').update(content).digest('hex') });
    expect(JSON.stringify(result)).not.toContain('BODY_SECRET');
    expect(await fs.readFile(file, 'utf8')).toBe(content);
    expect(await fs.readFile(path.join(base, 'catalog/collections.json'), 'utf8')).toBe(before);
    expect(await collectionInfo(base, 'roles')).toEqual(registration && { rootRelative: '.', include: ['engineering'], kind: 'role', metadata: 'frontmatter' });
    expect((await resolveMember(base, 'roles', 'engineering/embedded')).member.path).toBe(file);
  });

  it('reports missing registration separately from unknown asset and unknown member', async () => {
    await fs.rm(path.join(base, 'catalog/collections.json'));
    expect(await collectionInfo(base, 'roles')).toBeNull();
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND' });
    await expect(listMembers(base, 'unknown')).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await save();
    await expect(resolveMember(base, 'roles', 'engineering/absent')).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('uses literal bounded searches, returns source line numbers and short excerpts without complete document', async () => {
    const content = '---\nname: Firmware\ndescription: ARM firmware specialist\n---\n# Hardware\nPrivate opening text\n' + ('prefix ' + 'x'.repeat(300) + ' needle matched text\n').repeat(7);
    await write('engineering/firmware.md', content);
    expect((await listMembers(base, 'roles', { query: 'ARM firmware' })).matched).toBe(1);
    expect((await listMembers(base, 'roles', { query: '.*' })).matched).toBe(0);
    const result = await listMembers(base, 'roles', { mode: 'content', query: 'needle' });
    expect(result.members[0]).toMatchObject({ matchedLines: 7, truncated: true });
    expect(result.members[0].matches).toHaveLength(5);
    expect(result.members[0].matches[0].line).toBe(7);
    expect(result.members[0].matches.every((match: any) => match.excerpt.length <= 240 && match.excerpt.includes('needle'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Private opening text');
    for (const query of ['', 'x'.repeat(201), '\u0000']) await expect(listMembers(base, 'roles', { query })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(listMembers(base, 'roles', { mode: 'content' })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    for (const id of ['../outside', '/tmp/file', 'engineering//file', 'engineering/../file', 'engineering/.env']) await expect(resolveMember(base, 'roles', id)).rejects.toMatchObject({ code: 'INVALID_MEMBER_ID' });
  });

  it('rejects root and include escapes even when target remains inside globally allowed roots', async () => {
    registration.rootRelative = '../other';
    await save();
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'INVALID_COLLECTION' });
    registration.rootRelative = '.';
    registration.include = ['../other'];
    await save();
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'INVALID_COLLECTION' });
    await fs.mkdir(path.join(root, 'other'));
    await fs.symlink(path.join(root, 'other'), path.join(owner, 'linked'));
    registration.include = ['linked'];
    await save();
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'COLLECTION_PATH_ESCAPE' });
  });

  it('skips symbolic members and denied directories/files without reading or publishing their contents', async () => {
    const file = await write('engineering/firmware.md', '---\nname: Safe\ndescription: Safe role\n---');
    await write('engineering/backups/secret.md', 'PRIVATE_BACKUP');
    await write('engineering/.env.md', 'PRIVATE_CREDENTIAL');
    await write('engineering/CONTEXT.md', 'PRIVATE_CHAT');
    await write('outside.md', 'PRIVATE_OUTSIDE');
    await fs.symlink(path.join(owner, 'outside.md'), path.join(owner, 'engineering/alias.md'));
    await fs.symlink(path.join(owner, 'engineering'), path.join(owner, 'engineering/cycle'));
    const result = await listMembers(base, 'roles');
    expect(result.members.map(item => item.path)).toEqual([file]);
    expect(result.warnings).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('does not index malformed YAML or unsupported PDF; document mode keeps bodies out of metadata', async () => {
    await write('engineering/broken.md', '---\nname: [\n---\nLEAK_INVALID_YAML');
    await write('engineering/missing.md', '# Missing frontmatter\nLEAK_BODY');
    await write('engineering/guide.pdf', 'FAKE_PDF_PRIVATE');
    let result = await listMembers(base, 'roles');
    expect(result.total).toBe(0);
    expect(result.warnings).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('LEAK_');
    registration.metadata = 'document';
    registration.kind = 'reference';
    await save();
    result = await listMembers(base, 'roles');
    expect(result.members.find(item => item.id === 'engineering/missing')).toMatchObject({ title: 'Missing frontmatter', description: '', kind: 'reference' });
    expect(JSON.stringify(result)).not.toContain('LEAK_BODY');
  });

  it('assigns stable IDs to non-ASCII paths and rejects duplicate include registration', async () => {
    registration.metadata = 'document';
    await save();
    await write('engineering/中文指南.md', '# 指南');
    const first = await listMembers(base, 'roles');
    expect(first.members[0].id).toMatch(/^document-[a-f0-9]{24}$/);
    expect((await resolveMember(base, 'roles', first.members[0].id)).member.title).toBe('指南');
    // On case-insensitive macOS, different extension case still aliases the file;
    // distinct Unicode normalization does not safely test ID collisions there.
    registration.include = ['engineering', 'engineering'];
    await save();
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'INVALID_COLLECTION' });
  });

  it('rejects oversized files and count exhaustion instead of silently returning a partial collection', async () => {
    await write('engineering/huge.md', 'x'.repeat(256 * 1024 + 1));
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'COLLECTION_LIMIT' });
    await fs.rm(path.join(owner, 'engineering/huge.md'));
    await Promise.all(Array.from({ length: 501 }, (_, i) => write(`engineering/member-${i}.md`, '---\nname: Valid\ndescription: Role\n---')));
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'COLLECTION_LIMIT' });
  });

  it('rejects the cumulative byte budget even if each individual file is within the limit', async () => {
    registration.metadata = 'document';
    await save();
    const content = '# Reference\n' + 'a'.repeat(256 * 1024 - 12);
    expect(Buffer.byteLength(content)).toBe(256 * 1024);
    await Promise.all(Array.from({ length: 129 }, (_, i) => write(`engineering/large-${i}.md`, content)));
    await expect(listMembers(base, 'roles')).rejects.toMatchObject({ code: 'COLLECTION_LIMIT' });
  });
});
