// Isolated offline checks using this repository's own locked development dependencies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'pi-jev-check-'));
try {
  const home = join(temporary, 'home');
  await mkdir(home);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    PI_CODING_AGENT_DIR: join(home, '.pi/agent'),
    PI_OFFLINE: '1',
  };
  const run = (...args) => {
    const result = spawnSync(process.execPath, args, {
      cwd: temporary, env, encoding: 'utf8', timeout: 60_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  };
  for (const extension of ['pi-jev-router', 'pi-jev-tools']) {
    run(join(root, 'extensions', extension, 'tests/pi-check.mjs'),
      join(root, 'node_modules/@earendil-works/pi-coding-agent'),
      join(root, 'node_modules/typescript'));
  }
  run(join(root, 'scripts/copied-discovery.mjs'));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
