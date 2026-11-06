'use strict';

// Симуляция запроса Claude Code: system как массив блоков, tools, stream, tool_result.
process.env.PORT = process.env.PORT || '8805';
require('../src/index.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${process.env.PORT}`;

const tools = [
  {
    name: 'Bash',
    description: 'Run a shell command in the working directory',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' }, description: { type: 'string' } },
      required: ['command'],
    },
  },
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

const system = [
  {
    type: 'text',
    text: 'You are Claude Code, Anthropic\'s official CLI for Claude. You help with software engineering tasks. Use the tools available to complete the task. Be concise.',
    cache_control: { type: 'ephemeral' },
  },
];

async function run(messages, label) {
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'alice-ai',
      max_tokens: 2048,
      stream: true,
      system,
      tools,
      messages,
      metadata: { user_id: 'test' },
    }),
  });

  const raw = await res.text();
  const events = raw
    .split('\n\n')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const d = b.split('\n').find((l) => l.startsWith('data: '));
      try {
        return d ? JSON.parse(d.slice(6)) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const text = events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
    .map((e) => e.delta.text)
    .join('');

  const toolStarts = events.filter((e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
  const jsonDeltas = events
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta')
    .map((e) => e.delta.partial_json)
    .join('');
  const delta = events.find((e) => e.type === 'message_delta');

  console.log(`\n### ${label}`);
  console.log('stop_reason:', delta?.delta?.stop_reason);
  console.log('text:', text.slice(0, 300) || '(пусто)');
  for (const t of toolStarts) {
    console.log('tool_use:', t.content_block.name, jsonDeltas ? jsonDeltas.slice(0, 200) : '');
  }
  return { text, toolStarts, jsonDeltas, stop: delta?.delta?.stop_reason };
}

(async () => {
  await wait(300);

  const step1 = await run(
    [{ role: 'user', content: 'Создай файл hello.txt с текстом hello world. Используй инструмент.' }],
    'шаг 1: пользователь просит действие'
  );

  const toolName = step1.toolStarts[0]?.content_block?.name;
  if (!toolName) {
    console.log('\nбез tool_use — второй шаг пропускаем');
    process.exit(0);
  }

  let input = {};
  try {
    input = JSON.parse(step1.jsonDeltas || '{}');
  } catch {
    /* ignore */
  }

  await run(
    [
      { role: 'user', content: 'Создай файл hello.txt с текстом hello world. Используй инструмент.' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: step1.text },
          { type: 'tool_use', id: 'toolu_1', name: toolName, input },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'File created successfully' },
        ],
      },
    ],
    'шаг 2: tool_result возвращается модели'
  );

  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
