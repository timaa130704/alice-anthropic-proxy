'use strict';
const A = require('../src/anthropic.js');

const py = `Готово, вот код:

\`\`\`python
html = r"""<!DOCTYPE html>
<html lang="ru"><body><h1>Привет</h1><p>${'x'.repeat(300)}</p></body></html>"""
\`\`\`

Файл прикреплён.`;

const plain =
  'Держи:\n\n```html\n<!DOCTYPE html>\n<html><body><p>' +
  'y'.repeat(300) +
  '</p></body></html>\n```\n\nГотово.';

const cut = '```html\n<!DOCTYPE html>\n<html><body><p>' + 'z'.repeat(500);

console.log('python-строка:', A.extractHtmlArtifact(py)?.content.length);
console.log('--- pool debug:');
for (const m of py.matchAll(/[rR]?"""([\s\S]*?)"""/g)) console.log('  triple:', JSON.stringify(m[1].slice(0, 40)));
for (const m of py.matchAll(/```(?:html|htm)?\s*([\s\S]*?)```/gi)) console.log('  fence :', JSON.stringify(m[1].slice(0, 40)));
console.log('забор html   :', A.extractHtmlArtifact(plain)?.content.length);
console.log('обрезанный   :', A.extractHtmlArtifact(cut));
console.log('имя файла    :', A.guessFileName('создай site.html пожалуйста'));
console.log('имя файла 2  :', A.guessFileName('сделай лендинг'));
