'use strict';

// Проверка: выдаст ли прокси целый tool_use на большой HTML-файл.
const base = process.env.PROXY_URL || 'http://127.0.0.1:8787';

const prompt = `Сделай одностраничный лендинг в стиле редакционных статей Anthropic: тёплый бумажный фон #F0EEE6, serif-заголовки, тонкие линии, много воздуха.

Один файл index.html, только инлайн CSS в <style>, без внешних шрифтов и картинок.
Палитра: фон #F0EEE6, текст #1F1E1D, вторичный #6B6862, акцент #CC785C, линии #D9D5C9.
Структура: шапка, hero с kicker и h1, полоса из 3 метрик, три блока «зачем» в 3 колонки,
цитата с линией акцента, блок кода на тёмном, CTA по центру, футер из 4 колонок.
Текст по-русски, осмысленный, без lorem ipsum и без маркетингового визга.

Создай файл через инструмент Write.`;

const tools = [
  {
    name: 'Write',
    description: 'Write content to a file',
    input_schema: {
      type: 'object',
      properties: { file_path: { type: 'string' }, content: { type: 'string' } },
      required: ['file_path', 'content'],
    },
  },
];

(async () => {
  const started = Date.now();
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'alice-ai',
      max_tokens: 8000,
      stream: true,
      tools,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const raw = await res.text();
  const events = raw
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data: ')))
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const tool = events.find((e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
  const json = events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta')
    .map((e) => e.delta.partial_json)
    .join('');
  const text = events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map((e) => e.delta.text)
    .join('');
  const stop = events.find((e) => e.type === 'message_delta')?.delta?.stop_reason;

  console.log(`время: ${Date.now() - started}ms`);
  console.log(`stop_reason: ${stop}`);
  console.log(`tool: ${tool?.content_block?.name || '(нет)'}`);
  console.log(`длина input: ${json.length}`);
  try {
    const parsed = JSON.parse(json);
    console.log(`файл: ${parsed.file_path}`);
    console.log(`html: ${parsed.content.length} символов`);
    const html = parsed.content;
    console.log(`закрыт html: ${/<\/html>\s*$/.test(html.trim())}`);
    console.log(`хвост: ${JSON.stringify(html.slice(-60))}`);
  } catch (e) {
    console.log('JSON не распарсился:', e.message);
    console.log('начало текста:', JSON.stringify(text.slice(0, 400)));
    console.log('есть <tool_use>:', /<tool_use>/i.test(text));
    console.log('есть ```html:', /```html/i.test(text));
    console.log('хвост текста:', JSON.stringify(text.slice(-80)));
  }
})();
