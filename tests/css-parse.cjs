const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const cssPath = path.join(__dirname, '..', 'style.css');
csstree.parse(fs.readFileSync(cssPath, 'utf8'));
console.log('CSS parse: OK');
