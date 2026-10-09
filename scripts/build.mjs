import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: { admin: 'src/web/admin.tsx', display: 'src/web/display.tsx' }, outdir: 'dist', bundle: true, minify: true, sourcemap: false, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic' });
for (const name of ['admin','display']) await writeFile(`dist/${name}.html`, `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>FRAME · ${name === 'admin' ? 'Control Room' : 'Broadcast'}</title><link rel="stylesheet" href="/${name}.css"></head><body><div id="root"></div><script type="module" src="/${name}.js"></script></body></html>`);
console.log('Built separate operator and broadcast bundles.');
