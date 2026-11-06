'use strict';

/**
 * Телеграм-бот поверх alice-anthropic-proxy.
 *
 * Запуск:   node bot/telegram.js
 * Проверка без телеграма:  node bot/telegram.js --say "привет, как дела"
 *
 * Переменные (.env):
 *   BOT_TOKEN        токен от @BotFather (обязателен)
 *   BOT_PROXY_URL    по умолчанию http://127.0.0.1:8787
 *   BOT_TRIGGER      слово-триггер, по умолчанию «пидорас»
 *   BOT_HISTORY      сколько реплик помнить, по умолчанию 8
 *   BOT_MODEL        модель для запроса, по умолчанию alice-ai
 */

const fs = require('node:fs');
const path = require('node:path');

require('../src/config.js'); // подхватывает .env

const TOKEN = process.env.BOT_TOKEN || '';
const PROXY = (process.env.BOT_PROXY_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const TRIGGER = process.env.BOT_TRIGGER || 'пидорас';
const HISTORY = Number(process.env.BOT_HISTORY || 8);
const MODEL = process.env.BOT_MODEL || 'alice-ai';

const PERSONA = fs.readFileSync(path.join(__dirname, 'persona.txt'), 'utf8').trim();

const log = (...a) => process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}\n`);

/** История по чатам: массив пар {role, content}. */
const histories = new Map();
const busy = new Set();

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Слово-триггер как отдельный токен, в любом регистре. */
const TRIGGER_RE = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRe(TRIGGER)})(?=$|[^\\p{L}\\p{N}_])`, 'iu');

/** Выдёргиваем запрос из сообщения: до и после триггера. */
function extractPrompt(text) {
  const m = TRIGGER_RE.exec(text);
  if (!m) return null;
  const before = text.slice(0, m.index).trim();
  const after = text.slice(m.index + m[0].length).trim();
  const prompt = [before, after].filter(Boolean).join(' ').replace(/^[,.:;!?\-\s]+/, '').trim();
  return prompt || 'чё хотел';
}

function pushHistory(chatId, user, assistant) {
  const list = histories.get(chatId) || [];
  list.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
  while (list.length > HISTORY * 2) list.shift();
  histories.set(chatId, list);
}

/** Спрашиваем прокси. Возвращаем текст ответа. */
async function ask(prompt, chatId) {
  const history = chatId ? histories.get(chatId) || [] : [];
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: PERSONA,
    messages: [...history, { role: 'user', content: prompt }],
  };

  const res = await fetch(`${PROXY}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`proxy ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();

  return text || '(ноль ответа, попробуй ещё раз)';
}

/** Телеграм режет сообщения по 4096 — бьём по границе слова. */
function chunk(text, size = 3900) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.6) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.6) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    log(`tg ${method} error: ${data.error_code} ${data.description || ''}`);
    if (data.error_code === 429) {
      await new Promise((r) => setTimeout(r, (data.parameters?.retry_after || 3) * 1000));
    }
  }
  return data;
}

async function reply(chatId, messageId, text) {
  for (const part of chunk(text)) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: part,
      reply_to_message_id: messageId,
      allow_sending_without_reply: true,
    });
  }
}

async function handleMessage(msg) {
  const text = msg.text || msg.caption;
  if (!text || msg.from?.is_bot) return;

  const chatId = msg.chat.id;
  const prompt = extractPrompt(text);
  if (!prompt) return;
  if (busy.has(chatId)) {
    await tg('sendMessage', { chat_id: chatId, text: 'погоди, я занята' });
    return;
  }

  busy.add(chatId);
  const started = Date.now();
  try {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
    const answer = await ask(prompt, chatId);
    pushHistory(chatId, prompt, answer);
    await reply(chatId, msg.message_id, answer);
    log(`<- ${chatId} ${Date.now() - started}ms ${answer.length} символов`);
  } catch (err) {
    log(`!! ${chatId} ${err.message}`);
    await tg('sendMessage', { chat_id: chatId, text: `сломалась: ${err.message.slice(0, 120)}` });
  } finally {
    busy.delete(chatId);
  }
}

async function poll() {
  let offset = 0;
  log(`бот слушает прокси ${PROXY}, триггер «${TRIGGER}»`);

  for (;;) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          offset,
          timeout: 30,
          allowed_updates: ['message', 'channel_post'],
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        log(`getUpdates: ${data.error_code} ${data.description}`);
        if (data.error_code === 409) log('где-то уже запущен другой экземпляр бота');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        const msg = upd.message || upd.channel_post;
        if (!msg) continue;
        handleMessage(msg).catch((e) => log(`handle: ${e.message}`));
      }
    } catch (err) {
      log(`poll: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const sayIdx = process.argv.indexOf('--say');
if (require.main === module && sayIdx !== -1) {
  const text = process.argv.slice(sayIdx + 1).join(' ');
  ask(text)
    .then((answer) => {
      process.stdout.write(answer + '\n');
      process.exit(0);
    })
    .catch((e) => {
      process.stderr.write(`FAILED: ${e.message}\n`);
      process.exit(1);
    });
} else if (require.main === module) {
  if (!TOKEN) {
    process.stderr.write('нет BOT_TOKEN — создай бота у @BotFather и положи токен в .env\n');
    process.exit(1);
  }
  poll();
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { extractPrompt, chunk, ask };
