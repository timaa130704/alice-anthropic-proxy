'use strict';

// Без телеграма: проверяем вырезание триггера и нарезку длинных сообщений.
const { extractPrompt, chunk } = require('../bot/telegram.js');

const cases = [
  'пидорас как дела',
  'Пидорас, объясни рекурсию',
  'эй пидорас чё молчишь',
  'пидорас',
  'просто сообщение без триггера',
  'пидорасы не отвечают',
  'пидорасВызов не триггер',
];

for (const text of cases) {
  const out = extractPrompt(text);
  console.log(JSON.stringify(text).padEnd(38), '->', out === null ? '—' : JSON.stringify(out));
}

const long = 'слово '.repeat(2000);
const parts = chunk(long);
console.log('\nчанков:', parts.length, '| макс длина:', Math.max(...parts.map((p) => p.length)));
