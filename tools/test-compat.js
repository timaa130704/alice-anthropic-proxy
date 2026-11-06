'use strict';

// Полная проверка совместимости: обычный ответ, стрим, tool_use.
process.env.PORT = process.env.PORT || '8800';
require('../src/index.js');

const base = `http://127.0.0.1:${process.env.PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (body) =>
  fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function checkStream() {
  const res = await post({
    model: 'alice-ai',
    max_tokens: 512,
    stream: true,
    messages: [{ role: 'user', content: 'Посчитай 12+30. Ответь одним числом.' }],
  });
  const raw = await res.text();
  const events = raw
    .split('\n\n')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const ev = /event: (.*)/.exec(b);
      const data = /data: (.*)/.exec(b);
      return { event: ev && ev[1], data: data && JSON.parse(data[1]) };
    });
  const text = events
    .filter((e) => e.data?.type === 'content_block_delta')
    .map((e) => e.data.delta.text)
    .join('');
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    events: events.map((e) => e.event),
    text,
  };
}

async function checkTools() {
  const res = await post({
    model: 'alice-ai',
    max_tokens: 512,
    tools: [
      {
        name: 'get_weather',
        description: 'Вернуть погоду в городе',
        input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      },
    ],
    messages: [{ role: 'user', content: 'Какая сейчас погода в Москве? Используй инструмент.' }],
  });
  const json = await res.json();
  return {
    status: res.status,
    stop_reason: json.stop_reason,
    content: json.content,
  };
}

(async () => {
  await wait(300);
  const results = {};
  try {
    results.stream = await checkStream();
  } catch (e) {
    results.stream = { error: e.message };
  }
  try {
    results.tools = await checkTools();
  } catch (e) {
    results.tools = { error: e.message };
  }
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
