// Builds a single-file, serverless version of the app (the domain engine runs in the browser and
// stores data in IndexedDB). Used for the hosted test link and for offline demos.
// Usage: npm run build   (requires the esbuild dev dependency)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
await mkdir(out, { recursive: true });

const res = await build({
  entryPoints: [join(root, 'web/js/main.js')], bundle: true, format: 'iife', minify: true, write: false,
  target: ['es2022', 'chrome100', 'safari15'], legalComments: 'none',
  // The server maps /core to the shared engine folder; mirror that mapping for the bundle.
  plugins: [{ name: 'core-alias', setup(b) { b.onResolve({ filter: /^\.\.\/core\// }, (a) => ({ path: join(root, a.path.slice(3)) })); } }],
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await readFile(join(root, 'web/css/app.css'), 'utf8')).replace(/\s*\n\s*/g, '\n');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">';
const body = `<a class="skip" href="#main">Skip to content</a>
<header id="top" class="top"></header>
<div id="offline" class="strip bad" role="status" hidden>You are offline. Changes will fail until your connection returns.</div>
<main id="main" tabindex="-1"><div id="boot" class="boot"><p>Loading PRORESMAT…</p></div></main>
<div id="nav"></div>
<div id="toasts" class="toasts" aria-live="polite"></div>
<script>window.PRORESMAT_STANDALONE = true;</script>
<script>${js}</script>`;

// Full HTML document for opening directly in a browser.
await writeFile(join(out, 'proresmat-standalone.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PRORESMAT Health Connect</title><meta name="theme-color" content="#176b55">${fonts}<style>${css}</style></head>
<body>${body}</body></html>`);

// Fragment for hosts that supply their own document skeleton (claude.ai artifacts).
await writeFile(join(out, 'proresmat-artifact.html'), `<title>PRORESMAT Health Connect</title>
${fonts}<style>${css}</style>
${body}`);
console.log(`Built dist/proresmat-standalone.html and dist/proresmat-artifact.html (${(js.length / 1024).toFixed(0)} KB of JS)`);
