// Builds all app icons from the SVG sources in design/icon.
//   1. Renders the full icon to a 1024 px PNG and runs `tauri icon` for every platform size.
//   2. Rebuilds icon.ico so the 16–32 px frames use the simplified small-size artwork.
//   3. Copies the logo for the frontend (sidebar, splash).
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'design', 'icon');
const outDir = join(root, 'src-tauri', 'icons');
const buildDir = join(root, 'design', 'icon', 'build');
mkdirSync(buildDir, { recursive: true });

const render = (svgFile, size) => {
  const svg = readFileSync(join(iconDir, svgFile), 'utf8');
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
};

const masterPng = join(buildDir, 'wifinatio-1024.png');
writeFileSync(masterPng, render('wifinatio.svg', 1024));
execSync(`npx tauri icon "${masterPng}" -o "${outDir}"`, { cwd: root, stdio: 'inherit' });

const icoFrames = [16, 20, 24, 32].map((size) => render('wifinatio-small.svg', size))
  .concat([40, 48, 64, 128, 256].map((size) => render('wifinatio.svg', size)));
writeFileSync(join(outDir, 'icon.ico'), await pngToIco(icoFrames));
writeFileSync(join(outDir, 'tray.png'), render('wifinatio-small.svg', 64));

mkdirSync(join(root, 'src', 'assets'), { recursive: true });
copyFileSync(join(iconDir, 'wifinatio.svg'), join(root, 'src', 'assets', 'logo.svg'));
copyFileSync(join(iconDir, 'wifinatio-small.svg'), join(root, 'public', 'favicon.svg'));
console.log('Icons written to', outDir);
