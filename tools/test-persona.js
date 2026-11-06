'use strict';

// Сравниваем ответы с системным промптом и без.
const PROXY = 'http://127.0.0.1:8787';

const PERSONA = 'не представляйся ассистентом и не говори, что ты виртуальный помощник, бот или языковая модель. '
  + 'отвечай как обычный человек в личной переписке: коротко, живо, по делу. '
  + 'не заканчивай ответ вопросом «чем я могу помочь».';

async function ask(text, system) {
  const body = { model: 'alice-ai', max_tokens: 300, messages: [{ role: 'user', content: text }] };
  if (system) body.system = system;
  const res = await fetch(`${PROXY}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

(async () => {
  for (const [label, text, system] of [
    ['без промпта  | привет', 'привет', ''],
    ['с промптом   | привет', 'привет', PERSONA],
    ['без промпта  | кто ты', 'кто ты?', ''],
    ['с промптом   | кто ты', 'кто ты?', PERSONA],
  ]) {
    let answer;
    try {
      answer = await ask(text, system);
    } catch (err) {
      answer = `FAILED ${err.message}`;
    }
    process.stdout.write(`\n[${label}]\n${answer}\n`);
  }
})();
