#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = 'com.moduvela.workspace-hub';
const uid = process.getuid?.();
const domain = `gui/${uid}`;
const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function control(args, required = true) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8', timeout: 15000 });
  if (required && (result.error || result.status !== 0)) throw new Error(`launchctl ${args[0]} failed: ${result.error?.message || result.stderr.trim()}`);
  return result;
}
const action = process.argv[2] || 'status';
try {
  if (process.platform !== 'darwin' || !Number.isInteger(uid)) throw new Error('This launcher manages a user macOS LaunchAgent only.');
  if (action === 'install') {
    await fs.access(path.join(base, '.next/BUILD_ID'));
    try {
      const existing = await fs.readFile(plist, 'utf8');
      if (!existing.includes(escape(base))) throw new Error('Existing service belongs to another checkout; preserve it.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(path.dirname(plist), { recursive: true });
    await fs.mkdir(path.join(base, '.local'), { recursive: true });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(base, 'node_modules/next/dist/bin/next'))}</string><string>start</string><string>-p</string><string>4176</string><string>-H</string><string>127.0.0.1</string></array>
<key>WorkingDirectory</key><string>${escape(base)}</string>
<key>EnvironmentVariables</key><dict><key>PORT</key><string>4176</string><key>NEXT_TELEMETRY_DISABLED</key><string>1</string><key>PATH</key><string>${escape(path.dirname(process.execPath))}:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${escape(path.join(base, '.local/server.out.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(base, '.local/server.err.log'))}</string>
</dict></plist>`;
    control(['bootout', `${domain}/${label}`], false);
    await fs.writeFile(plist, xml, { mode: 0o600 });
    control(['bootstrap', domain, plist]);
    console.log('Installed user LaunchAgent. Local URL: http://127.0.0.1:4176/hub');
  } else if (action === 'stop') {
    control(['bootout', `${domain}/${label}`]);
    console.log('Stopped this Workspace Hub service. The plist is retained.');
  } else if (action === 'start') {
    control(['bootstrap', domain, plist]);
    console.log('Started this Workspace Hub service.');
  } else if (action === 'status') {
    const result = control(['print', `${domain}/${label}`], false);
    console.log(JSON.stringify({ installed: result.status === 0, pid: result.stdout?.match(/\bpid = (\d+)/)?.[1] || null, url: 'http://127.0.0.1:4176/hub' }));
  } else throw new Error('Usage: node scripts/hub-service.mjs install|start|stop|status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
