'use strict';

// Проверка: тело в cp1251 (как шлёт PowerShell 5.1) должно декодироваться правильно.
process.env.PORT = process.env.PORT || '8804';
require('../src/index.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// "кто ты" в cp1251
const CP1251 = { к: 0xea, т: 0xf2, о: 0xee, ы: 0xfb, ' ': 0x20, '?': 0x3f };
const cp = (s) => Buffer.from([...s].map((ch) => CP1251[ch] ?? ch.charCodeAt(0)));

(async () => {
  await wait(300);
  const base = `http://127.0.0.1:${process.env.PORT}`;

  const utf8 = '{"model":"alice-ai","max_tokens":64,"messages":[{"role":"user","content":"кто ты"}]}';
  const broken = cp(utf8);

  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: broken,
  });
  const json = await res.json();
  const answer = json.content?.[0]?.text || '';

  console.log('status', res.status);
  console.log('answer:', answer.slice(0, 200));
  const looksGarbled = /набор символов|необычн|зашифрован/i.test(answer);
  console.log(looksGarbled ? 'FAIL: текст пришёл битым' : 'OK: cp1251 декодирован');
  process.exit(looksGarbled ? 2 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
