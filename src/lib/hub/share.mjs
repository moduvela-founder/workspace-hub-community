import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ROOT_FILES = ['AGENTS.md', 'LICENSE', 'PROVENANCE.md', '.gitignore', '.gitattributes', 'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json', 'vitest.config.ts'];
const SCRIPTS = ['hub.mjs', 'hub-services.mjs', 'hub-service.mjs', 'export-share.mjs', 'setup-share.mjs'];
// Export shared contracts, not the private catalogue's adapters or case histories.
const SOURCE_TREES = ['src', 'skills/workspace-catalog', 'skills/session-closeout', 'templates/entity', 'templates/workspace', 'tests'];
const SHARED_GUIDES = ['README', 'asset-model', 'delivery-workflow', 'document-contract', 'knowledge-collections', 'local-services', 'onboarding', 'project-rules', 'storage-and-outputs', 'ui-delivery'];
const GUIDE_FILES = [...SHARED_GUIDES.map(name => `docs/hub/${name}.md`), 'docs/share/README.md', 'docs/share/使用说明.txt'];
const PRIVATE_ADAPTER_PATHS = new Set(['src/lib/feishu', 'tests/hub-feishu.test.ts']);
const EXCLUDED = new Set(['.git', '.local', '.next', '.env', 'node_modules', 'upstream', 'credentials', 'secrets', 'backups']);
const exists = file => fs.lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });

async function regularFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error(`Unsupported share source: ${file}`);
  return fs.readFile(file);
}

async function copyTree(source, destination, relative = '') {
  if (PRIVATE_ADAPTER_PATHS.has(relative)) return;
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Share source must not be a symlink: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) {
      if (name.startsWith('.') || EXCLUDED.has(name)) continue;
      await copyTree(path.join(source, name), path.join(destination, name), path.posix.join(relative, name));
    }
  } else {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, await regularFile(source), { flag: 'wx', mode: stat.mode & 0o777 });
  }
}

async function listFiles(base, relative = '') {
  const files = [];
  for (const entry of (await fs.readdir(path.join(base, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(base, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

export function findPathMentions(text) {
  const prefix = /^(?:\/(?:Users|Volumes|opt|Applications|home|mnt|media|path|usr|private|var|srv)(?:\/|$)|[A-Za-z]:[\\/]|~\/)/;
  const found = new Set();
  const covered = [];
  for (const quoted of [/`([^`\r\n]+)`/g, /'([^'\r\n]+)'/g, /"([^"\r\n]+)"/g, /<(\/[^<>\r\n]+)>/g]) {
    for (const match of text.matchAll(quoted)) if (prefix.test(match[1])) {
      found.add(match[1]); covered.push([match.index, match.index + match[0].length]);
    }
  }
  const bare = [...text].map((char, index) => covered.some(([start, end]) => index >= start && index < end) ? ' ' : char).join('');
  for (const match of bare.matchAll(/(?:\/(?:Users|Volumes|opt|Applications|home|mnt|media|path|usr|private|var|srv)\/[^\s<>\])）"'`|，；。]+|[A-Za-z]:\\[^\s<>\])）"'`|，；。]+|~\/(?:\.codex|\.agents|Projects)[^\s<>\])）"'`|，；。]*)/g)) found.add(match[0].replace(/[.,;:]+$/, ''));
  return [...found].sort();
}

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEXT_FILE = /(?:\.(?:md|txt|json|ya?ml|[cm]?js|tsx?|css|html|toml)|(?:^|\/)(?:LICENSE|\.gitignore|\.gitattributes))$/i;

/** Transform exported copies only; never persist the private mapping. */
export function sanitizeShareText(input, { sourceRoot, privateAccounts = [], privateSessionIds = [] } = {}) {
  let text = input;
  const mappings = [];
  if (sourceRoot) {
    mappings.push([sourceRoot, '/path/to/workspace-hub']);
    const workspace = path.dirname(sourceRoot);
    if (workspace !== path.parse(workspace).root) mappings.push([workspace, '/path/to/workspace']);
    const home = sourceRoot.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
    if (home) mappings.push([home, '/home/your-user']);
  }
  for (const [value, replacement] of mappings) {
    for (const encode of [encodeURIComponent, encodeURI, value => value]) text = text.replace(new RegExp(escapePattern(encode(value)), 'gi'), () => encode(replacement));
  }
  text = text.replace(/%2f(?:Users|home)%2f(?:(?!%2f)[^\s<>"'`])+/gi, encodeURIComponent('/home/your-user'));
  for (const value of findPathMentions(text)) {
    const replacement = value
      .replace(/^\/(?:Users|home)\/[^/]+/, '/home/your-user')
      .replace(/^([A-Za-z]:)(\\+)Users\2[^\\]+/i, (_match, drive, separator) => `${drive}${separator}Users${separator}your-user`)
      .replace(/^\/Volumes\/[^/]+/, '/path/to/large-files')
      .replace(/^\/opt\/homebrew(?=\/|$)/, '/path/to/tools')
      .replace(/^\/Applications(?=\/|$)/, '/path/to/tools')
      .replace(/^\/(?:private\/)?var\/folders\/.*$/, '/path/to/local-evidence');
    if (replacement !== value) text = text.split(value).join(replacement);
  }
  for (const account of privateAccounts) {
    if (typeof account !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(account)) throw new Error('Invalid private account name');
    text = text.replace(new RegExp(escapePattern(account), 'gi'), 'example-org');
  }
  text = text.replace(/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, '192.0.2.10');
  text = text.replace(/codex:\/\/threads\/[0-9a-f-]{20,}/gi, 'codex://threads/EXAMPLE-SESSION-ID');
  for (const id of privateSessionIds) if (/^[0-9a-f-]{20,}$/i.test(id)) text = text.replace(new RegExp(escapePattern(id), 'gi'), 'EXAMPLE-SESSION-ID');
  text = text.replace(/smb:\/\/[^\s<>\])）"'`|]+/gi, 'smb://fileserver.example.invalid/share');
  text = text.replace(/https?:\/\/([a-z0-9-]+)\.feishu\.cn\/[^\s<>\])）"'`|]*/gi, (value, tenant) => ['open', 'accounts', 'example', 'tenant', 'test', 'fixture'].includes(tenant.toLowerCase()) ? value : 'https://example.feishu.cn/wiki/ExampleWikiNode123');
  text = text.replace(/\bgithub-(?!example\b)[a-z0-9_-]+(?=:)/gi, 'github-example');
  return text;
}

function assertNoCredentials(text, name) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{40,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/.test(text)) throw new Error(`Credential-like content is excluded from sharing: ${name}`);
}

function exampleDocuments() {
  return {
    'README.md': '# 示例项目\n\n这是虚构的接入示例，请替换为自己的项目；不代表真实产品或验收结果。\n',
    'AGENTS.md': '# 示例项目规则\n\n按任务读取[共享规则](../../docs/hub/project-rules.md)，保留本项目自己的需求与验收约定；分析保持只读。\n',
    'STATUS.md': '---\nschemaVersion: 1\ngoal: 学习登记项目与维护当前目标\nstage: intention\nactivity: unknown\nreadiness: unimplemented\nstartedAt: null\nconfirmedAt: null\n---\n\n# 当前状态\n\n仅为虚构示例，尚未实施或验证。\n',
    'MANUAL_STEPS.md': '# 人工与外部事项\n\n- [ ] 换成自己的项目后，确认目标、当前模式及验收条件。\n',
  };
}

async function directory(candidate, label) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error(`${label} must be an existing absolute directory`);
  const real = await fs.realpath(candidate);
  if (!(await fs.stat(real)).isDirectory() || real === path.parse(real).root) throw new Error(`${label} must be a non-root directory`);
  return real;
}

/** Only standard Node APIs: this runs before dependencies are installed. */
export async function setupShare(base, { projectsRoot, largeFilesRoot, apply = false } = {}) {
  const root = await directory(path.resolve(base), 'Hub root');
  const projects = await directory(projectsRoot ?? path.join(root, 'examples'), 'Projects root');
  const largeFiles = largeFilesRoot == null ? null : await directory(largeFilesRoot, 'Large-files root');
  const demo = path.join(root, 'examples/demo-project');
  const outputs = {
    'hub.config.json': { schemaVersion: 1, roots: [...new Set([root, projects])], excludedNames: ['node_modules', 'upstream', '.git', '.local', '.next', 'build', 'dist', 'backups', 'archives', 'worktrees', 'src', 'scripts', 'docs', 'templates', 'skills', 'tests', 'catalog', 'public', 'examples'] },
    'catalog/assets.json': {
      schemaVersion: 1,
      assets: [
        { id: 'workspace-hub', kind: 'tool', title: 'Workspace Hub', workspace: '本机', summary: '源码分享包的本机入口，按说明接入自己的项目。', goal: '管理本机项目入口与已记录事实', stage: 'implementation', activity: 'active', readiness: 'unverified', tags: ['本机工具'], repositoryIds: [], uses: [], ownerPath: root, entrypoint: path.join(root, 'README.md'), statusFile: null, manualStepsFile: null, sources: [{ path: path.join(root, 'README.md'), note: '本机部署与配置说明' }] },
        { id: 'demo-project', kind: 'product', title: '示例项目（虚构）', workspace: '示例', summary: '演示项目目标、阶段和文档入口，请替换为自己的登记。', goal: '学习登记项目与维护当前目标', stage: 'intention', activity: 'unknown', readiness: 'unimplemented', tags: ['虚构示例'], repositoryIds: [], uses: [], ownerPath: demo, entrypoint: path.join(demo, 'README.md'), statusFile: path.join(demo, 'STATUS.md'), manualStepsFile: path.join(demo, 'MANUAL_STEPS.md'), sources: [{ path: path.join(demo, 'README.md'), note: '分享包合成示例，不是原作者产品数据' }] },
      ],
      repositories: [],
    },
    'catalog/services.json': { schemaVersion: 1, services: [] },
    'catalog/collections.json': { schemaVersion: 1, collections: [
      { assetId: 'workspace-hub', rootRelative: 'docs', include: ['hub'], kind: 'reference', metadata: 'document' },
      { assetId: 'demo-project', rootRelative: '.', include: ['.'], kind: 'reference', metadata: 'document' },
    ] },
    '.local/storage.json': { schemaVersion: 1, largeFilesRoot: largeFiles, mode: 'reference-only', note: '仅记录约定，不迁移文件、不改变 Docker 或构建工具设置；未配置时沿用项目已有输出位置。' },
  };
  for (const name of ['catalog', '.local']) {
    const target = path.join(root, name);
    if (await exists(target) && (await fs.lstat(target)).isSymbolicLink()) throw new Error(`Setup directory must not be a symlink: ${name}`);
  }
  for (const name of Object.keys(outputs)) if (await exists(path.join(root, name))) throw new Error(`Refusing to overwrite existing configuration: ${name}`);
  for (const name of Object.keys(exampleDocuments())) await regularFile(path.join(demo, name));
  const result = { preview: !apply, root, projectsRoot: projects, largeFilesRoot: largeFiles, files: Object.keys(outputs) };
  if (!apply) return result;
  const created = [];
  try {
    for (const [name, value] of Object.entries(outputs)) {
      const target = path.join(root, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: name.startsWith('.local/') ? 0o600 : 0o644 });
      created.push(target);
    }
  } catch (error) {
    await Promise.all(created.map(file => fs.unlink(file)));
    throw error;
  }
  return result;
}

export async function exportShare(sourceRoot, { outputDirectory, privateAccounts = [], python = 'python3' } = {}) {
  const root = await directory(path.resolve(sourceRoot), 'Source root');
  const pkg = JSON.parse((await regularFile(path.join(root, 'package.json'))).toString('utf8'));
  const output = path.resolve(outputDirectory ?? path.join(root, '.local/artifacts/share'));
  const build = path.join(root, '.local/build');
  await fs.mkdir(build, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(build, 'share-export-'));
  const stage = path.join(temporary, 'workspace-hub-share');
  const generatedAt = new Date().toISOString();
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/\D/g, '');
  const version = String(pkg.version).replace(/[^0-9A-Za-z._-]/g, '-');
  const stem = `workspace-hub-share-${version}-${stamp}`;
  const zipPath = path.join(output, `${stem}.zip`);
  const instructionsPath = path.join(output, `${stem}-使用说明.txt`);
  const created = [];
  try {
    if (await exists(zipPath) || await exists(instructionsPath)) throw new Error('Share output already exists; choose a different output directory or retry later');
    await fs.mkdir(stage);
    for (const name of ROOT_FILES) if (await exists(path.join(root, name))) await copyTree(path.join(root, name), path.join(stage, name));
    for (const name of SOURCE_TREES) if (await exists(path.join(root, name))) await copyTree(path.join(root, name), path.join(stage, name), name);
    for (const name of GUIDE_FILES) if (await exists(path.join(root, name))) await copyTree(path.join(root, name), path.join(stage, name));
    for (const name of SCRIPTS) if (await exists(path.join(root, 'scripts', name))) await copyTree(path.join(root, 'scripts', name), path.join(stage, 'scripts', name));
    const instructions = path.join(stage, 'AGENTS.md');
    if (await exists(instructions)) {
      const original = await fs.readFile(instructions, 'utf8');
      await fs.writeFile(instructions, original.replace(/^- Shared Feishu parameters .*$/m, '- External parameter sources require a separately configured tool and its owning guide. Reading an asset reference does not authorize remote registration or modification; follow the current task and exact approved values.'));
    }
    const provenance = path.join(stage, 'PROVENANCE.md');
    if (await exists(provenance)) await fs.appendFile(provenance, '\n## 源码分享包范围\n\n上文记录开发仓库的来源；本 ZIP 只分发活跃运行时与规则，不包含停用的 upstream 目录、原仓库 Git 历史、真实目录登记或机器私有配置。上游固定来源与 MIT 声明继续保留。\n');
    const snippet = 'examples/codex/GLOBAL-AGENTS-SNIPPET.md';
    await copyTree(path.join(root, snippet), path.join(stage, snippet));
    const references = [{ path: snippet, kind: 'tracked-merge-suggestion', installed: false }];
    const demo = path.join(stage, 'examples/demo-project');
    await fs.mkdir(demo, { recursive: true });
    for (const [name, value] of Object.entries(exampleDocuments())) await fs.writeFile(path.join(demo, name), value, { flag: 'wx' });
    const accounts = [...privateAccounts];
    // A public origin is provenance, not a private account. Redact only names
    // explicitly supplied by the exporter so public clone links remain usable.
    const sourceHashes = new Map();
    const payloads = [];
    const sessionIds = new Set();
    for (const name of await listFiles(stage)) {
      const contents = await fs.readFile(path.join(stage, name));
      sourceHashes.set(name, digest(contents));
      if (!TEXT_FILE.test(name) || name === 'LICENSE') continue;
      const text = contents.toString('utf8');
      assertNoCredentials(text, name);
      for (const match of text.matchAll(/codex:\/\/threads\/([0-9a-f-]{20,})/gi)) sessionIds.add(match[1]);
      payloads.push([name, text]);
    }
    for (const [name, text] of payloads) await fs.writeFile(path.join(stage, name), sanitizeShareText(text, { sourceRoot: root, privateAccounts: accounts, privateSessionIds: [...sessionIds] }));
    const pathMentions = [];
    for (const name of await listFiles(stage)) {
      if (!/\.(?:md|txt)$/i.test(name)) continue;
      const lines = (await fs.readFile(path.join(stage, name), 'utf8')).split('\n');
      lines.forEach((line, index) => { for (const value of findPathMentions(line)) pathMentions.push({ file: name, line: index + 1, path: value }); });
    }
    for (const [source, name] of [['docs/share/README.md', 'README.md'], ['docs/share/使用说明.txt', '使用说明.txt']]) {
      const contents = (await regularFile(path.join(stage, source))).toString('utf8');
      await fs.writeFile(path.join(stage, name), contents, { flag: 'wx' });
    }
    let sourceRevision = null; let sourceDirty = null;
    try {
      sourceRevision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000 })).stdout.trim();
      sourceDirty = Boolean((await exec('git', ['status', '--porcelain'], { cwd: root, timeout: 5000 })).stdout.trim());
    } catch { /* A share package can itself be re-exported without Git. */ }
    const files = [];
    for (const name of await listFiles(stage)) {
      const sha256 = digest(await fs.readFile(path.join(stage, name)));
      const sourceSha256 = sourceHashes.get(name) ?? null;
      files.push({ path: name, sha256, sourceSha256, transformed: sourceSha256 !== null && sourceSha256 !== sha256 });
    }
    const ruleFiles = files.filter(file => file.path === 'AGENTS.md' || /^(?:docs\/hub\/|skills\/|templates\/|examples\/codex\/)/.test(file.path));
    const manifest = { schemaVersion: 1, generatedAt, sourceRevision, sourceDirty, version: pkg.version, references, files, ruleFiles, pathMentions, note: 'files covers payload except this manifest itself; only allowlisted general contracts and one fictional demo-project are included. Private catalogue cases, adapters, histories, mappings and personal global rules are excluded. sourceSha256 hashes the payload before final redaction.' };
    await fs.writeFile(path.join(stage, 'SHARE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    const temporaryZip = path.join(temporary, 'bundle.zip');
    const zipCode = 'import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED) as archive:\n for file in sorted(root.rglob("*")):\n  if file.is_file(): archive.write(file, "workspace-hub-share/"+file.relative_to(root).as_posix())\n';
    await exec(python, ['-c', zipCode, stage, temporaryZip], { timeout: 120000, maxBuffer: 16384 });
    await fs.copyFile(temporaryZip, zipPath, constants.COPYFILE_EXCL); created.push(zipPath);
    await fs.writeFile(instructionsPath, await fs.readFile(path.join(stage, '使用说明.txt')), { flag: 'wx' }); created.push(instructionsPath);
    return { zipPath, instructionsPath, sha256: digest(await fs.readFile(zipPath)), files: files.length + 1, ruleFiles: ruleFiles.length, pathMentions: pathMentions.length, sourceRevision, sourceDirty };
  } catch (error) {
    await Promise.all(created.map(file => fs.unlink(file)));
    throw error;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
