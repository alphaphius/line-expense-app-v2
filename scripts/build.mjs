import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const frontend = path.join(root, 'frontend');
const dist = path.join(root, 'dist');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(path.join(dist, 'vendor'), { recursive: true });

for (const file of ['index.html', 'manifest.webmanifest']) {
  await cp(path.join(frontend, file), path.join(dist, file));
}

const versionedAssets = ['styles.css','config.js','api.js','image-optimizer.js','offline-ocr.js','protected-access.js','receipts.js','app.js','pwa.js'];
let builtIndex = await readFile(path.join(dist, 'index.html'), 'utf8');
for (const asset of versionedAssets) builtIndex = builtIndex.replaceAll(`./${asset}`, `./${asset}?v=${packageJson.version}`);
await writeFile(path.join(dist, 'index.html'), builtIndex);

for (const file of ['api.js', 'image-optimizer.js', 'offline-ocr.js', 'protected-access.js', 'receipts.js', 'app.js', 'pwa.js']) {
  await build({
    entryPoints: [path.join(frontend, file)],
    outfile: path.join(dist, file),
    bundle: false,
    minify: true,
    target: ['safari15', 'chrome100', 'edge100', 'firefox100'],
    legalComments: 'none',
  });
}

const configuredEndpoint = String(process.env.V2_API_ENDPOINT || '').trim();
const configSource = await readFile(path.join(frontend, 'config.js'), 'utf8');
const builtConfig = configuredEndpoint
  ? configSource.replace(/apiEndpoint:\s*['"][^'"]*['"],/, `apiEndpoint: ${JSON.stringify(configuredEndpoint)},`)
  : configSource;
await writeFile(path.join(dist, 'config.js'), builtConfig);

let serviceWorker = await readFile(path.join(frontend, 'service-worker.js'), 'utf8');
serviceWorker = serviceWorker.replace(/workhub-shell-[^']+/, 'workhub-shell-' + packageJson.version + '-' + Date.now().toString(36));
await writeFile(path.join(dist, 'service-worker.js'), serviceWorker);

const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
await new Promise((resolve, reject) => {
  const child = spawn(bin, ['-c', path.join(root, 'tailwind.config.cjs'), '-i', path.join(frontend, 'styles.css'), '-o', path.join(dist, 'styles.css'), '--minify'], { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error('Tailwind build failed with exit code ' + code)));
});

try { await cp(path.join(frontend, 'icons'), path.join(dist, 'icons'), { recursive: true }); } catch (_) {}
await Promise.all([
  cp(path.join(root, 'node_modules', 'sweetalert2', 'dist', 'sweetalert2.all.min.js'), path.join(dist, 'vendor', 'sweetalert2.all.min.js')),
  cp(path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), path.join(dist, 'vendor', 'chart.umd.js')),
]);
const tesseractDist = path.join(dist, 'vendor', 'tesseract');
await mkdir(path.join(tesseractDist, 'core'), { recursive: true });
await mkdir(path.join(tesseractDist, 'lang'), { recursive: true });
await Promise.all([
  cp(path.join(root, 'node_modules', 'tesseract.js', 'dist', 'tesseract.min.js'), path.join(tesseractDist, 'tesseract.min.js')),
  cp(path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), path.join(tesseractDist, 'worker.min.js')),
  cp(path.join(root, 'node_modules', '@tesseract.js-data', 'tha', '4.0.0_best_int', 'tha.traineddata.gz'), path.join(tesseractDist, 'lang', 'tha.traineddata.gz')),
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm'].map(file =>
    cp(path.join(root, 'node_modules', 'tesseract.js-core', file), path.join(tesseractDist, 'core', file))
  ),
]);
console.log(`Built ${packageJson.name} ${packageJson.version} → ${dist}`);
