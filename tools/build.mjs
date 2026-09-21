// Fügt Vorlage, Stylesheet und Skripte zu EINER Datei zusammen:  node tools/build.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const jsDir = path.join(root, 'src/js');
const js = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  .map((f, i) => {
    let code = fs.readFileSync(path.join(jsDir, f), 'utf8');
    if (i > 0) code = code.replace(/^'use strict';\s*/, '');
    return code;
  }).join('\n');
if (/<\/script/i.test(js)) throw new Error('Skript enthält </script>');
new vm.Script(js, { filename: 'Dienstplan.js' }); // bricht bei Syntaxfehlern ab

const out = read('src/template.html')
  .replace('/*__CSS__*/', () => read('src/style.css'))
  .replace('/*__JS__*/', () => js);

fs.writeFileSync(path.join(root, 'Dienstplan.html'), out);
console.log('Dienstplan.html geschrieben (' + Math.round(out.length / 1024) + ' KB)');
