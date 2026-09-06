/**
 * Assembles public/demo.html — a self-contained, offline, single-tab demo of
 * the whole game (host + player + simulated teachers) that mirrors the real
 * server protocol. The real stylesheet is inlined so the demo can run from a
 * plain file without the server or any other assets.
 *
 *   node scripts/build-demo.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, 'demo-template.html'), 'utf8');

if (!template.includes('/*__CSS__*/')) {
  throw new Error('demo-template.html is missing the /*__CSS__*/ marker');
}

const html = template.replace('/*__CSS__*/', css);
fs.writeFileSync(path.join(root, 'public', 'demo.html'), html);
console.log('Wrote public/demo.html (' + html.length + ' bytes)');