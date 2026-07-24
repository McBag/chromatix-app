/**
 * Post-process the Vite build so the output matches the CRA layout expected
 * by Tesla static hosting / the existing server deployment:
 *
 *   build/
 *     index.html
 *     asset-manifest.json
 *     manifest.json
 *     robots.txt
 *     sitemap.xml
 *     icon/
 *     images/
 *     static/
 *       css/
 *       js/
 *       media/
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildPath = join(__dirname, '..', 'build');

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

// If Vite still emitted a flat assets/ folder, move files into CRA layout.
const legacyAssets = join(buildPath, 'assets');
if (existsSync(legacyAssets)) {
  const cssDir = join(buildPath, 'static', 'css');
  const jsDir = join(buildPath, 'static', 'js');
  const mediaDir = join(buildPath, 'static', 'media');
  mkdirSync(cssDir, { recursive: true });
  mkdirSync(jsDir, { recursive: true });
  mkdirSync(mediaDir, { recursive: true });

  for (const file of readdirSync(legacyAssets)) {
    const src = join(legacyAssets, file);
    if (!statSync(src).isFile()) continue;
    const ext = extname(file).toLowerCase();
    let destDir = mediaDir;
    if (ext === '.css') destDir = cssDir;
    else if (ext === '.js' || ext === '.mjs' || ext === '.map') destDir = jsDir;
    renameSync(src, join(destDir, file));
  }

  try {
    if (readdirSync(legacyAssets).length === 0) rmdirSync(legacyAssets);
  } catch {
    // ignore
  }
}

// Ensure index.html uses relative CRA paths
const indexPath = join(buildPath, 'index.html');
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, 'utf8');

  // Flat assets/ leftovers → static/*
  html = html.replace(/(["'])(?:\.\/)?assets\/([^"']+\.css)\1/g, (_m, q, name) => `${q}./static/css/${name}${q}`);
  html = html.replace(/(["'])(?:\.\/)?assets\/([^"']+\.js)\1/g, (_m, q, name) => `${q}./static/js/${name}${q}`);
  html = html.replace(/(["'])(?:\.\/)?assets\//g, `$1./static/media/`);

  // Absolute root paths → relative
  html = html.replace(/(href|src)="\/(static|icon|images|manifest\.json)/g, '$1="./$2');
  html = html.replace(/(href|src)="\/assets\//g, '$1="./static/');

  writeFileSync(indexPath, html);
}

// Generate CRA-style asset-manifest.json
const files = {};
const entrypoints = [];

for (const full of walk(buildPath)) {
  const rel = './' + toPosix(relative(buildPath, full));
  if (rel.startsWith('./static/css/') && rel.endsWith('.css')) {
    const base = rel.split('/').pop();
    if (base.startsWith('index.') || base.startsWith('main.')) {
      files['main.css'] = rel;
      entrypoints.push(rel.replace(/^\.\//, ''));
    }
    files[rel.replace(/^\.\//, '')] = rel;
  } else if (rel.startsWith('./static/js/') && rel.endsWith('.js') && !rel.includes('.LICENSE')) {
    const base = rel.split('/').pop();
    if (base.startsWith('index.') || base.startsWith('main.')) {
      files['main.js'] = rel;
      entrypoints.push(rel.replace(/^\.\//, ''));
    }
    files[rel.replace(/^\.\//, '')] = rel;
  } else if (rel.startsWith('./static/media/')) {
    files[rel.replace(/^\.\//, '')] = rel;
  } else if (rel === './index.html') {
    files['index.html'] = rel;
  }
}

writeFileSync(join(buildPath, 'asset-manifest.json'), JSON.stringify({ files, entrypoints }, null, 2) + '\n');

console.log('[finalize-cra-layout] asset-manifest.json written');
console.log('[finalize-cra-layout] Expected deploy tree: index.html, asset-manifest.json, icon/, images/, static/');
