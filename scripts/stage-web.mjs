import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'public');
const to = path.join(root, 'server', 'site');

if (!fs.existsSync(path.join(from, 'index.html'))) {
  console.error('The site build is missing public/index.html');
  process.exit(1);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('Copied the site build to server/site');
