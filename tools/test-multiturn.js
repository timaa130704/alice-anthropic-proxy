'use strict';

// Многоходовый диалог: проверяем, что история из messages доезжает до модели.
process.env.PORT = process.env.PORT || '8802';
require('../src/index.js');

const base = `http://127.0.0.1:${process.env.PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ask = async (messages) => {
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'alice-ai', max_tokens: 512, messages }),
  });
  const json = await res.json();
  return json.content.map((c) => c.text || '').join('');
};

(async () => {
  await wait(300);

  const q1 = 'Меня зовут Марк, запомни. Ответь одним коротким предложением.';
  const a1 = await ask([{ role: 'user', content: q1 }]);
  console.log('Q1:', q1);
  console.log('A1:', a1, '\n');

  const q2 = 'Как меня зовут? Ответь одним словом.';
  const a2 = await ask([
    { role: 'user', content: q1 },
    { role: 'assistant', content: a1 },
    { role: 'user', content: q2 },
  ]);
  console.log('Q2:', q2);
  console.log('A2:', a2);

  process.exit(/марк/i.test(a2) ? 0 : 2);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
