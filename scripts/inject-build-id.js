const fs = require('fs');
const path = require('path');

const buildId = String(Date.now());
const root = path.join(__dirname, '..');
const idPath = path.join(root, '.build-id');
const htmlPath = path.join(root, 'public', 'index.html');

fs.writeFileSync(idPath, buildId, 'utf8');

let html = fs.readFileSync(htmlPath, 'utf8');
if (html.includes('__BUILD_ID__')) {
  html = html.replace(/__BUILD_ID__/g, buildId);
  fs.writeFileSync(htmlPath, html, 'utf8');
}
console.log('Build ID:', buildId);
