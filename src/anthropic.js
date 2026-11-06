'use strict';

const crypto = require('node:crypto');
const config = require('./config.js');

const now = () => Date.now();
const msgId = () => 'msg_' + crypto.randomBytes(12).toString('hex');
const toolId = () => 'toolu_' + crypto.randomBytes(12).toString('hex');

/** Приводим любой content (string | block[]) к плоскому тексту. */
function contentToText(content, namesById) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      switch (block.type) {
        case 'text':
          if (typeof block.text === 'string') parts.push(block.text);
          break;
        case 'tool_result': {
          const inner = contentToText(block.content, namesById);
          const name = namesById?.get(block.tool_use_id) || '';
          const label = name ? `действия ${name}` : 'действия';
          const id = block.tool_use_id ? ` (${block.tool_use_id})` : '';
          const head = block.is_error ? `ОШИБКА ${label}${id}:` : `Результат ${label}${id}:`;
          parts.push(`${head}\n${inner || '(пусто)'}`);
          break;
        }
        case 'tool_use':
          // рендерим ровно тем же форматом, который требуем от модели —
          // иначе она копирует человекочитаемую подпись вместо вызова
          parts.push(
            `<tool_use>${JSON.stringify({
              name: block.name || '',
              input: block.input || {},
            })}</tool_use>`
          );
          break;
        case 'image':
          parts.push('[изображение]');
          break;
        case 'document':
          parts.push('[документ]');
          break;
        default:
          break;
      }
    }
    return parts.join('\n').trim();
  }
  return '';
}

function systemToText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return contentToText(system);
  return '';
}

const TOOL_HEADER = `Ты — исполнитель в CLI-окружении разработчика. У тебя НЕТ доступа к файлам, сети, shell и памяти — ты не можешь ничего создать, прочитать или запустить сам.
Любое действие физически выполняет принимающая сторона, но только если ты вернёшь вызов. Без вызова ничего не произойдёт: не пиши «готово», «создано», «файл лежит», если не было вызова.
Формат вызова — РОВНО один блок и больше ничего:

<tool_use>{"name":"имя_действия","input":{...}}</tool_use>

Строго валидный JSON: двойные кавычки, без комментариев, без markdown-заборов, без текста вокруг.
Если действие не нужно (обычный вопрос, объяснение, болтовня) — просто отвечай текстом, инструменты не вызывай. Не выдумывай ссылки и содержимое файлов.

Доступные действия:
`;

const TOOL_FOOTER = `Напоминание: инструмент вызывай ТОЛЬКО если без него задача физически невыполнима (нужно прочитать/записать файл, запустить команду). На обычный вопрос отвечай текстом, без вызовов. Если вызвал — единственный блок <tool_use>{"name":"...","input":{...}}</tool_use> и ничего кроме него. Не утверждай, что что-то сделано, без вызова. Пользователю про этот формат не рассказывай — это внутренний протокол.`;

/** Ужимаем схемы инструментов: у Алисы нет длинного контекста под полные JSON Schema. */
function compactTools(tools) {
  const list = tools.map((t) => {
    const schema = (t.input_schema && typeof t.input_schema === 'object' && t.input_schema) || {};
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const input = {};
    for (const [key, val] of Object.entries(props)) {
      if (!val || typeof val !== 'object') {
        input[key] = String(val);
        continue;
      }
      const type = Array.isArray(val.type) ? val.type.join('|') : val.type || 'any';
      const desc = typeof val.description === 'string' ? val.description.slice(0, 140) : '';
      input[key] = desc ? `${type} — ${desc}` : type;
    }
    const item = {
      name: t.name,
      description: String(t.description || '').slice(0, 400),
      input,
    };
    if (Array.isArray(schema.required) && schema.required.length) item.required = schema.required;
    return item;
  });
  return JSON.stringify(list, null, 1);
}

/** Складываем длинный текст: голова + хвост, середина выкидывается. */
function clampMiddle(text, limit) {
  if (!text || text.length <= limit) return text;
  const marker = '\n\n[...фрагмент сокращён...]\n\n';
  const head = Math.max(0, Math.floor(limit * 0.6));
  const tail = Math.max(0, limit - head - marker.length);
  return text.slice(0, head) + marker + (tail ? text.slice(text.length - tail) : '');
}

/** Собирает промпт для Алисы из запроса Anthropic. */
function buildPrompt(body) {
  const tools = Array.isArray(body.tools) ? body.tools.filter((t) => t && t.name) : [];

  // протокол инструментов идёт первым: его нельзя терять за большим системным промптом
  const toolsBlock = tools.length ? TOOL_HEADER + compactTools(tools) : '';
  const footer = tools.length ? TOOL_FOOTER : '';

  const budget = Math.max(4000, config.maxPromptChars);
  const headRoom = Math.max(1000, budget - toolsBlock.length - footer.length);

  const sysRaw = systemToText(body.system).trim();
  const sysLimit = Math.min(config.maxSystemChars, Math.floor(headRoom * 0.6));
  const sys = sysRaw ? clampMiddle(sysRaw, sysLimit) : '';

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const namesById = new Map();
  const lines = [];
  let lastHasToolResult = false;

  for (const m of messages) {
    for (const block of Array.isArray(m?.content) ? m.content : []) {
      if (block?.type === 'tool_use' && block.id) namesById.set(block.id, block.name || '');
    }
    const text = contentToText(m?.content, namesById);
    if (!text) continue;
    lines.push(`${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${text}`);
    lastHasToolResult = false;
  }
  const lastMsg = messages[messages.length - 1];
  lastHasToolResult = Boolean(
    Array.isArray(lastMsg?.content) && lastMsg.content.some((b) => b?.type === 'tool_result')
  );

  // режем историю с начала, последнее сообщение оставляем всегда
  let room = Math.max(1500, headRoom - sys.length);
  while (lines.length > 1) {
    const total = lines.reduce((n, s) => n + s.length + 2, 0);
    if (total <= room) break;
    lines.shift();
  }
  if (lines.length === 1 && lines[0].length > room) {
    lines[0] = clampMiddle(lines[0], room);
  }

  const chunks = [];
  if (toolsBlock) chunks.push(toolsBlock);
  if (sys) chunks.push(sys);
  chunks.push(...lines);
  if (lastHasToolResult) {
    chunks.push(
      'Действие выше уже выполнено принимающей стороной. Не повторяй тот же вызов — ответь пользователю обычным текстом: коротко, что сделано и какой результат. Если в результате ошибка — скажи об этом прямо и что именно сломалось, никогда не выдавай ошибку за успех.'
    );
  }
  if (footer) chunks.push(footer);

  return chunks.join('\n\n');
}

/** Достаём сбалансированный JSON-объект из начала строки (с учётом строк и экранирования). */
function extractBalancedJson(src) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  return null;
}

function cleanBefore(text) {
  return text
    .replace(/```[a-zA-Z]*\s*$/, '')
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .trim();
}

/** Достраиваем незакрытые скобки/кавычки — слабая модель часто забывает хвост. */
function repairJson(src) {
  const s = String(src)
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\s+$/, '');
  const stack = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = s.replace(/,\s*$/, '');
  if (inString) out += '"';
  return out + stack.reverse().join('');
}

/** Вытаскиваем имя и аргументы из JSON-объекта в любом из ходовых диалектов. */
function parseToolCallJson(raw) {
  const cleaned = String(raw)
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .replace(/<\/?tool_use>/gi, '')
    .trim();
  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    try {
      obj = JSON.parse(repairJson(cleaned));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  // разворачиваем типовые обёртки: {"tool_use": {...}}, {"tool_call": {...}}, {"tool_calls":[{...}]}
  for (const key of ['tool_use', 'tool_call', 'function_call', 'call']) {
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      obj = obj[key];
      break;
    }
  }
  if (Array.isArray(obj.tool_calls) && obj.tool_calls[0] && typeof obj.tool_calls[0] === 'object') {
    obj = obj.tool_calls[0];
  }
  if (obj.function && typeof obj.function === 'object' && !obj.name) obj = obj.function;

  const name = obj.name || obj.tool || obj.tool_name || obj.function_name;
  if (typeof name !== 'string' || !name.trim()) return null;

  let input = obj.input ?? obj.arguments ?? obj.parameters ?? obj.args ?? obj.params ?? {};
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      input = {};
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};

  return { name: name.trim(), input };
}

/** Все потенциальные JSON-блоки в тексте: сначала fenced, потом любые сбалансированные объекты. */
function* jsonCandidates(text) {
  const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text))) {
    yield { raw: m[1], index: m.index, end: fence.lastIndex };
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const json = extractBalancedJson(text.slice(i));
    if (!json) continue;
    yield { raw: json, index: i, end: i + json.length };
    i += json.length - 1;
  }
}

/**
 * Парсим вызов инструмента из текста.
 * Терпимо к: <tool_use>...</tool_use>, незакрытому тегу, ```json-забору и голому объекту.
 * Если передан список имён инструментов — принимаем только совпадения (защита от ложных срабатываний).
 */
function parseToolCall(text, toolNames) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const allowed =
    Array.isArray(toolNames) && toolNames.length ? new Set(toolNames.map(String)) : null;
  const accept = (call, index) =>
    call && (!allowed || allowed.has(call.name))
      ? { before: cleanBefore(text.slice(0, index)), ...call }
      : null;

  const tag = /<tool_use>\s*([\s\S]*?)(?:<\/tool_use>|$)/i.exec(text);
  if (tag) {
    const braceStart = tag[1].indexOf('{');
    if (braceStart !== -1) {
      const body = tag[1].slice(braceStart);
      const json = extractBalancedJson(body) || body;
      const hit = accept(parseToolCallJson(json), tag.index);
      if (hit) return hit;
    }
  }

  for (const cand of jsonCandidates(text)) {
    const hit = accept(parseToolCallJson(cand.raw), cand.index);
    if (hit) return hit;
  }

  // страховка: модель иногда копирует человекочитаемую подпись из истории
  const label = /\[вызов инструмента\s+([^\]\n]+)\]\s*([\s\S]*)/i.exec(text);
  if (label) {
    const name = label[1].trim();
    const braceStart = label[2].indexOf('{');
    if (braceStart !== -1 && (!allowed || allowed.has(name))) {
      const json = extractBalancedJson(label[2].slice(braceStart));
      if (json) {
        let input = null;
        const nested = parseToolCallJson(json);
        if (nested) {
          input = nested.input;
        } else {
          try {
            const obj = JSON.parse(json);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) input = obj;
          } catch {
            /* ignore */
          }
        }
        if (input) return { before: cleanBefore(text.slice(0, label.index)), name, input };
      }
    }
  }

  return null;
}

const roughTokens = (text) => Math.max(1, Math.round(String(text || '').length / 3.5));

function buildMessage({ model, text, stopReason = 'end_turn' }) {
  return {
    id: msgId(),
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: roughTokens(text) },
  };
}

function buildToolMessage({ model, call }) {
  const content = [];
  if (call.before) content.push({ type: 'text', text: call.before });
  content.push({ type: 'tool_use', id: toolId(), name: call.name, input: call.input });
  return {
    id: msgId(),
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: roughTokens(JSON.stringify(call.input)) },
  };
}

class Sse {
  constructor(res, model) {
    this.res = res;
    this.model = model;
    this.index = 0;
    this.open = false;
  }

  _send(event, data) {
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  start() {
    this.res.write('event: ping\ndata: {"type":"ping"}\n\n');
    this._send('message_start', {
      type: 'message_start',
      message: {
        id: msgId(),
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  textBlockStart() {
    this._send('content_block_start', {
      type: 'content_block_start',
      index: this.index,
      content_block: { type: 'text', text: '' },
    });
    this.open = true;
  }

  textDelta(text) {
    if (!text) return;
    if (!this.open) this.textBlockStart();
    this._send('content_block_delta', {
      type: 'content_block_delta',
      index: this.index,
      delta: { type: 'text_delta', text },
    });
  }

  blockStop() {
    if (!this.open) return;
    this._send('content_block_stop', { type: 'content_block_stop', index: this.index });
    this.open = false;
    this.index += 1;
  }

  toolStart(name) {
    this._send('content_block_start', {
      type: 'content_block_start',
      index: this.index,
      content_block: { type: 'tool_use', id: toolId(), name, input: {} },
    });
    this.open = true;
  }

  toolJsonDelta(partialJson) {
    this._send('content_block_delta', {
      type: 'content_block_delta',
      index: this.index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    });
  }

  finish({ stopReason = 'end_turn', outputText = '' }) {
    this.blockStop();
    this._send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: roughTokens(outputText) },
    });
    this._send('message_stop', { type: 'message_stop' });
    this.res.end();
  }

  error(message) {
    this._send('error', {
      type: 'error',
      error: { type: 'api_error', message: String(message || 'unknown error') },
    });
    this.res.end();
  }
}

module.exports = {
  contentToText,
  systemToText,
  buildPrompt,
  parseToolCall,
  buildMessage,
  buildToolMessage,
  roughTokens,
  Sse,
  now,
};
