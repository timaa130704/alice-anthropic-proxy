'use strict';

/**
 * Быстрый вопрос к уже запущенному прокси, без проблем с кодировкой PowerShell.
 *   node tools/ask.js "кто ты? одним предложением"
 *   node tools/ask.js --no-stream "привет"
 *   node tools/ask.js --url http://127.0.0.1:8787 "привет"
 */

const args = process.argv.slice(2);
let url = process.env.PROXY_URL || 'http://127.0.0.1:8787';
let stream = true;
const words = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--no-stream') stream = false;
  else if (a === '--url') url = args[++i];
  else words.push(a);
}

const text = words.join(' ') || 'привет! ответь одним предложением';
const endpoint = `${url.replace(/\/$/, '')}/v1/messages`;

(async () => {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      model: 'alice-ai',
      max_tokens: 2048,
      stream,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!res.ok) {
    console.error('HTTP', res.status, await res.text());
    process.exit(1);
  }

  if (!stream) {
    const json = await res.json();
    console.log(json.content.map((c) => c.text || `[${c.type}]`).join(''));
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      let ev;
      try {
        ev = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }
      if (ev.type === 'content_block_delta' && ev.delta?.text) process.stdout.write(ev.delta.text);
      else if (ev.type === 'error') console.error('\n[error]', ev.error?.message);
    }
  }
  process.stdout.write('\n');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
