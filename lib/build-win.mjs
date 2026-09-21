import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

process.env.VITE_VERSION = pkg.version;
process.env.VITE_DATE = String(Math.floor(Date.now() / 1000));
// Already-set env wins over .env, so a dev file cannot compile the console API
// or local Jellyfin credentials into the Tesla bundle.
process.env.VITE_ENV = 'production';

const vite = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  cwd: root,
  env: { ...process.env },
});

if ((vite.status ?? 1) !== 0) {
  process.exit(vite.status ?? 1);
}

// Reshape to CRA-compatible static/ tree + asset-manifest.json for Tesla static hosting
// Do not use shell:true here — spaces in the project path would break the args.
const finalize = spawnSync(process.execPath, [join(__dirname, 'finalize-cra-layout.mjs')], {
  stdio: 'inherit',
  shell: false,
  cwd: root,
});

process.exit(finalize.status ?? 1);
