'use strict';
const A = require('../src/anthropic.js');

const names = ['Write', 'Read', 'Bash'];

const cases = [
  ['тег', '<tool_use>{"name":"Write","input":{"file_path":"a.txt","content":"x"}}</tool_use>'],
  ['забор', '```json\n{"name":"Write","input":{"file_path":"a.txt"}}\n```'],
  ['голый', '{"name":"Write","input":{"file_path":"a.txt"}}'],
  ['обёртка', '```json\n{"tool_use":{"name":"Write","input":{"file_path":"a.txt"}}}\n```'],
  ['копия подписи', '[вызов инструмента Write]\n{"file_path":"ebalay.txt","content":""}'],
  ['мусор', 'просто текст без вызова'],
  ['чужое имя', '{"name":"Nope","input":{}}'],
  [
    'кривые скобки',
    '```json\n<tool_use>\n{"name":"Write",\n"input":{"file_path":"C:\\\\Users\\\\zeiss\\\\probe.txt",\n"content":""}\n</tool_use>\n```',
  ],
  ['висячая запятая', '{"name":"Write","input":{"file_path":"a.txt",},}'],
  [
    'экранированные скобки',
    '<tool_use>{"name":"Write","input":{"file_path":"\\/path\\/to\\/website.html","content":"\\<html\\>\\n\\<body\\>\\n\\<p\\>хуй\\n\\<\\/body\\>\\n\\<\\/html\\>"}}</tool_use>',
  ],
];

for (const [label, text] of cases) {
  const call = A.parseToolCall(text, names);
  console.log(label.padEnd(16), call ? `${call.name} ${JSON.stringify(call.input)}` : '—');
}
