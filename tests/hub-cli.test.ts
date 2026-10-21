import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('../scripts/hub.mjs', import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, [script, ...args], {
  cwd: base, encoding: 'utf8', timeout: 10_000,
});
let full: { fingerprint: string; changed: boolean; files: { path: string; sha256: string }[] };

beforeAll(() => { full = JSON.parse(run('rules', '--json')); });

describe('rules CLI output', () => {
  it('returns a compact first-check result without per-file hashes', () => {
    expect(JSON.parse(run('rules', '--summary', '--json'))).toEqual({
      fingerprint: full.fingerprint, changed: true,
    });
  });

  it('preserves since comparison and accepts either boolean flag order', () => {
    expect(JSON.parse(run('rules', '--json', '--summary', '--since', full.fingerprint))).toEqual({
      fingerprint: full.fingerprint, changed: false,
    });
    expect(JSON.parse(run('rules', '--since', '0'.repeat(64), '--summary', '--json'))).toEqual({
      fingerprint: full.fingerprint, changed: true,
    });
  });

  it('omits file lists from text summaries for first and unchanged checks', () => {
    for (const args of [[], ['--since', full.fingerprint]]) {
      const lines = run('rules', '--summary', ...args).trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(`Rules SHA256: ${full.fingerprint}`);
      expect(lines[1]).toContain(args.length ? 'Unchanged' : 'first check');
    }
  });

  it('retains the original complete JSON and text output without summary', () => {
    expect(full.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(full.changed).toBe(true);
    expect(full.files.length).toBeGreaterThan(0);
    const text = run('rules', '--since', full.fingerprint);
    for (const file of full.files) expect(text).toContain(`${file.sha256}  ${file.path}`);
  });

  it('rejects summary on unrelated commands before executing them', () => {
    const result = spawnSync(process.execPath, [script, 'search', '--summary', '--query', 'example'], {
      cwd: base, encoding: 'utf8', timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--summary is only supported by rules');
    expect(result.stdout).toBe('');
  });
});
