'use strict';

// Полный прогон через HTTP: запускает сервер в том же процессе и дергает /v1/messages.
process.env.PORT = process.env.PORT || '8799';
require('../src/index.js');

const body = {
  model: 'alice-ai',
  max_tokens: 1024,
  stream: process.argv.includes('--stream'),
  messages: [
    { role: 'user', content: 'Привет! Кто ты? Ответь двумя предложениями.' },
  ],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(400);
  const res = await fetch(`http://127.0.0.1:${process.env.PORT}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('status', res.status, res.headers.get('content-type'));
  if (!body.stream) {
    console.log(JSON.stringify(await res.json(), null, 2));
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      process.stdout.write(buf);
      buf = '';
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
