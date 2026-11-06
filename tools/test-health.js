'use strict';

// Проверка /health и /v1/models на живом сервере.
process.env.PORT = process.env.PORT || '8803';
require('../src/index.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(300);
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const health = await fetch(`${base}/health`);
  console.log('/health', health.status, await health.text());

  const models = await fetch(`${base}/v1/models`);
  const json = await models.json();
  console.log('/v1/models', models.status, json.data.map((m) => m.id).join(', '));
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
