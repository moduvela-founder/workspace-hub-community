import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exportShare, setupShare, findPathMentions, sanitizeShareText } from '../src/lib/hub/share.mjs';

let temporary: string;
let source: string;
const rule = `# Rule\n\nRead \`${path.posix.join('/Users', 'example', 'projects')}\` and \`${path.posix.join('/Volumes', 'Example', 'artifacts')}\` only after configuring your environment.\n`;
async function write(relative: string, value: string) {
  const file = path.join(source, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}
async function unpack(zip: string, destination: string) {
  execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as archive: archive.extractall(sys.argv[2])', zip, destination]);
  return path.join(destination, 'workspace-hub-share');
}
async function bundle(destination = path.join(temporary, 'output')) {
  return exportShare(source, { outputDirectory: destination });
}
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-share-test-'));
  source = path.join(temporary, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(temporary, 'AGENTS.md'), 'PRIVATE-PARENT-RULES');
  await write('package.json', '{"version":"0.1.0"}\n');
  await write('AGENTS.md', rule);
  await write('LICENSE', 'MIT License\n');
  await write('PROVENANCE.md', 'Pinned upstream source\n');
  await write('src/lib/example.mjs', 'export const example = true;\n');
  await write('src/app/api/hub/catalog/route.ts', 'export const GET = () => null;\n');
  await write('src/lib/feishu/registry.mjs', 'PRIVATE-ADAPTER');
  await write('tests/hub-feishu.test.ts', 'PRIVATE-ADAPTER');
  await write('scripts/hub-feishu.mjs', 'PRIVATE-ADAPTER');
  await write('docs/hub/project-rules.md', rule);
  await write('docs/hub/private-project-notes.md', 'PRIVATE-CASE-HISTORY');
  await write('docs/capabilities/private-tool.md', 'PRIVATE-CASE-HISTORY');
  await write('docs/workflows/private-release/STATUS.md', 'PRIVATE-CASE-HISTORY');
  await write('skills/workspace-catalog/SKILL.md', rule);
  await write('skills/agency-guide/SKILL.md', 'PRIVATE-CASE-HISTORY');
  await write('skills/private-project/SKILL.md', 'PRIVATE-CASE-HISTORY');
  await write('templates/entity/AGENTS.md', rule);
  await write('templates/workspace/AGENTS.md', '# Generic workspace\n\nRead each target project\'s own instructions before work.\n');
  await write('docs/share/README.md', '# Deploy\n\nRun the setup command.\n');
  await write('docs/share/使用说明.txt', 'Deploy locally.\n');
  await write('examples/codex/GLOBAL-AGENTS-SNIPPET.md', '# Suggested merge\n\nRead the Hub guide on demand.\n');
  await write('examples/codex/AGENTS.global.md', 'PRIVATE-GLOBAL-RULES');
  await write('examples/codex/AGENTS.workspace.md', 'PRIVATE-WORKSPACE-RULES');
  await write('catalog/assets.json', 'PRIVATE-CATALOG');
  await write('hub.config.json', 'PRIVATE-CONFIG');
  await write('STATUS.md', 'PRIVATE-STATUS');
  await write('.local/secret.txt', 'PRIVATE-SECRET');
  await write('upstream/old.md', 'OLD-UPSTREAM');
  await write('public/help/old.md', 'OLD-HELP');
  await write('scripts/verify-hub.mjs', 'PRIVATE-VERIFICATION');
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

describe('share export and first setup', () => {
  it('exports allowlisted general rules and one fictional example without private cases or global/runtime/history data', async () => {
    const result = await bundle();
    const root = await unpack(result.zipPath, path.join(temporary, 'unpacked'));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'SHARE-MANIFEST.json'), 'utf8'));
    expect(await fs.readFile(path.join(root, 'src/app/api/hub/catalog/route.ts'), 'utf8')).toBe('export const GET = () => null;\n');
    for (const name of ['AGENTS.md', 'docs/hub/project-rules.md', 'skills/workspace-catalog/SKILL.md', 'templates/entity/AGENTS.md']) {
      expect(await fs.readFile(path.join(root, name), 'utf8')).toBe(sanitizeShareText(rule));
      const record = manifest.ruleFiles.find((file: { path: string }) => file.path === name);
      expect(record.sourceSha256).toBe(crypto.createHash('sha256').update(rule).digest('hex'));
      expect(record.transformed).toBe(true);
    }
    expect(await fs.readFile(path.join(root, 'examples/codex/GLOBAL-AGENTS-SNIPPET.md'), 'utf8')).toContain('Suggested merge');
    expect(await fs.readFile(path.join(root, 'templates/workspace/AGENTS.md'), 'utf8')).toContain('Generic workspace');
    expect(await fs.readdir(path.join(root, 'examples/codex'))).toEqual(['GLOBAL-AGENTS-SNIPPET.md']);
    expect(await fs.readdir(path.join(root, 'examples'))).toEqual(['codex', 'demo-project']);
    for (const name of ['catalog/assets.json', 'hub.config.json', 'STATUS.md', '.local/secret.txt', 'upstream/old.md', 'public/help/old.md', 'scripts/verify-hub.mjs', '.git', 'examples/codex/AGENTS.global.md', 'examples/codex/AGENTS.workspace.md', 'docs/hub/private-project-notes.md', 'docs/capabilities', 'docs/workflows', 'skills/agency-guide', 'skills/private-project', 'src/lib/feishu', 'tests/hub-feishu.test.ts', 'scripts/hub-feishu.mjs']) {
      await expect(fs.access(path.join(root, name))).rejects.toThrow();
    }
    for (const file of manifest.files) {
      const hash = crypto.createHash('sha256').update(await fs.readFile(path.join(root, file.path))).digest('hex');
      expect(hash).toBe(file.sha256);
    }
    expect(manifest.ruleFiles.some((file: { path: string }) => file.path === 'docs/hub/project-rules.md')).toBe(true);
    expect(result.sha256).toBe(crypto.createHash('sha256').update(await fs.readFile(result.zipPath)).digest('hex'));
    expect(await fs.readFile(result.instructionsPath, 'utf8')).toBe(await fs.readFile(path.join(root, '使用说明.txt'), 'utf8'));
  });

  it('keeps path auditing in the manifest without expanding the short instructions into a case inventory', async () => {
    const result = await bundle();
    const root = await unpack(result.zipPath, path.join(temporary, 'unpacked'));
    for (const name of ['README.md', '使用说明.txt']) {
      const text = await fs.readFile(path.join(root, name), 'utf8');
      expect(text).not.toContain('/home/your-user/projects');
      expect(text).not.toContain('docs/hub/project-rules.md:3');
    }
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'SHARE-MANIFEST.json'), 'utf8'));
    expect(manifest.pathMentions).toContainEqual({ file: 'docs/hub/project-rules.md', line: 3, path: '/home/your-user/projects' });
    expect(await fs.readFile(path.join(source, 'docs/hub/project-rules.md'), 'utf8')).toBe(rule);
    expect(findPathMentions('`/path/to/tools/bin/node` C:\\Projects\\demo ~/.codex/AGENTS.md')).toEqual(['C:\\Projects\\demo', '/path/to/tools/bin/node', '~/.codex/AGENTS.md'].sort());
  });

  it('extracts quoted paths with spaces completely and avoids truncated duplicates', () => {
    const application = path.posix.join('/home', 'your-user', 'Library/Application Support/tool/cli');
    const windows = ['C:', 'Users', 'your-user', 'Application Support', 'tool.exe'].join('\\');
    const input = `TOOL='${application}'\n\`${windows}\`\n~/.codex/AGENTS.md /usr/bin/python3.8`;
    expect(findPathMentions(input)).toEqual([application, windows, '~/.codex/AGENTS.md', '/usr/bin/python3.8'].sort());
    const windowsPrivate = ['C:', 'Users', 'sample-author', 'Application Support', 'tool.exe'].join('\\');
    expect(JSON.parse(sanitizeShareText(JSON.stringify({ path: windowsPrivate }))).path).toBe(windows);
  });

  it('preserves a public origin link unless its owner is explicitly selected for redaction', async () => {
    const publicUrl = 'https://github.com/public-example-org/workspace-hub-community';
    execFileSync('git', ['init', '--quiet'], { cwd: source });
    execFileSync('git', ['remote', 'add', 'origin', publicUrl + '.git'], { cwd: source });
    await write('docs/share/README.md', '# Deploy\n\n' + publicUrl + '\n');
    const result = await bundle();
    const root = await unpack(result.zipPath, path.join(temporary, 'unpacked'));
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toContain(publicUrl);
    const redacted = await exportShare(source, { outputDirectory: path.join(temporary, 'redacted'), privateAccounts: ['public-example-org'] });
    const redactedRoot = await unpack(redacted.zipPath, path.join(temporary, 'redacted-unpacked'));
    expect(await fs.readFile(path.join(redactedRoot, 'README.md'), 'utf8')).toContain('https://github.com/example-org/workspace-hub-community');
  });

  it('redacts private values across every text payload and manifest without changing the source or license', async () => {
    const fixtureUrl = 'https://fixture.feishu.cn/wiki/WikiFixture?table=tblFixture&view=vewFixture';
    expect(sanitizeShareText(fixtureUrl)).toBe(fixtureUrl);
    const owner = 'sample-private-owner';
    const authorHome = path.posix.join('/Users', 'sample-author');
    const privateHub = path.posix.join(authorHome, 'Workspace', 'hub');
    const privateIp = [192, 168, 45, 87].join('.');
    const session = ['01234567', '89ab', '7cde', '8fab', '0123456789ab'].join('-');
    const sensitive = [privateHub, encodeURIComponent(privateHub), `${authorHome}/Library/Application Support/vendor/tool`, `https://github.com/${owner}/private-repo`, `http://${privateIp}/internal`, `codex://threads/${session}`, 'smb://fileserver.example.invalid/share'].join('\n');
    await write('docs/hub/project-rules.md', sensitive);
    await write('src/lib/private-reference.json', JSON.stringify({ authorHome, owner, privateIp, session }));
    const exported = await exportShare(source, { outputDirectory: path.join(temporary, 'output'), privateAccounts: [owner] });
    const root = await unpack(exported.zipPath, path.join(temporary, 'unpacked'));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'SHARE-MANIFEST.json'), 'utf8'));
    for (const name of [...manifest.files.map((file: { path: string }) => file.path), 'SHARE-MANIFEST.json']) {
      const text = await fs.readFile(path.join(root, name), 'utf8');
      for (const value of [authorHome, encodeURIComponent(authorHome), owner, privateIp, session, 'sample-private-server']) expect(text).not.toContain(value);
    }
    expect(await fs.readFile(path.join(root, 'LICENSE'), 'utf8')).toBe('MIT License\n');
    expect(await fs.readFile(path.join(source, 'docs/hub/project-rules.md'), 'utf8')).toBe(sensitive);
    expect(manifest.ruleFiles.find((file: { path: string }) => file.path === 'docs/hub/project-rules.md').transformed).toBe(true);
  });

  it('rejects explicit token/private-key material while allowing synthetic credential-validation examples', async () => {
    await write('docs/hub/project-rules.md', 'https://user:secret@example.com is a synthetic invalid-input fixture.');
    await bundle();
    await write('docs/hub/project-rules.md', 'ghp_' + 'A'.repeat(36));
    await expect(bundle(path.join(temporary, 'token-output'))).rejects.toThrow('Credential-like content');
  });

  it('previews without writes and initializes using the moved extraction root only', async () => {
    const result = await bundle();
    const unpacked = await unpack(result.zipPath, path.join(temporary, 'unpacked'));
    const moved = path.join(temporary, 'moved package');
    await fs.rename(unpacked, moved);
    const preview = await setupShare(moved);
    expect(preview.preview).toBe(true);
    await expect(fs.access(path.join(moved, 'hub.config.json'))).rejects.toThrow();
    const projects = path.join(temporary, 'my-projects');
    const large = path.join(temporary, 'large-files');
    await fs.mkdir(projects); await fs.mkdir(large);
    const applied = await setupShare(moved, { projectsRoot: projects, largeFilesRoot: large, apply: true });
    expect(applied.preview).toBe(false);
    const config = JSON.parse(await fs.readFile(path.join(moved, 'hub.config.json'), 'utf8'));
    expect(config.roots).toEqual([await fs.realpath(moved), await fs.realpath(projects)]);
    expect(config.excludedNames).toContain('src');
    const catalog = JSON.parse(await fs.readFile(path.join(moved, 'catalog/assets.json'), 'utf8'));
    expect(catalog.assets.map((asset: { id: string }) => asset.id)).toEqual(['workspace-hub', 'demo-project']);
    expect(catalog.assets[0].ownerPath).toBe(await fs.realpath(moved));
    expect(JSON.stringify(catalog)).not.toContain(source);
    expect(JSON.parse(await fs.readFile(path.join(moved, 'catalog/services.json'), 'utf8')).services).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(moved, 'catalog/collections.json'), 'utf8')).collections).toEqual([
      { assetId: 'workspace-hub', rootRelative: 'docs', include: ['hub'], kind: 'reference', metadata: 'document' },
      { assetId: 'demo-project', rootRelative: '.', include: ['.'], kind: 'reference', metadata: 'document' },
    ]);
    expect(JSON.parse(await fs.readFile(path.join(moved, '.local/storage.json'), 'utf8'))).toMatchObject({ largeFilesRoot: await fs.realpath(large), mode: 'reference-only' });
    expect(await fs.readdir(large)).toEqual([]);
    const before = await fs.readFile(path.join(moved, 'catalog/assets.json'));
    await expect(setupShare(moved, { apply: true })).rejects.toThrow('Refusing to overwrite');
    expect(await fs.readFile(path.join(moved, 'catalog/assets.json'))).toEqual(before);
  });

  it('rejects missing roots and symlinked setup destinations before writing configuration', async () => {
    const result = await bundle();
    const root = await unpack(result.zipPath, path.join(temporary, 'unpacked'));
    await expect(setupShare(root, { projectsRoot: 'relative', apply: true })).rejects.toThrow('absolute');
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, 'catalog'));
    await expect(setupShare(root, { apply: true })).rejects.toThrow('symlink');
    expect(await fs.readdir(outside)).toEqual([]);
    await expect(fs.access(path.join(root, 'hub.config.json'))).rejects.toThrow();
  });
});
