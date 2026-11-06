'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const config = require('./config');
const { AliceClient } = require('./alice');
const A = require('./anthropic');

const alice = new AliceClient();

const MODELS = [
  { id: 'alice-ai', display_name: 'Alice AI', created: 1735689600 },
  { id: 'alice-ai-pro', display_name: 'Alice AI Pro', created: 1735689600 },
  { id: 'alice-ai-fast', display_name: 'Alice AI Fast', created: 1735689600 },
  { id: 'claude-3-5-sonnet-20241022', display_name: 'Alice AI (claude alias)', created: 1735689600 },
  { id: 'claude-sonnet-4-5-20250929', display_name: 'Alice AI (claude alias)', created: 1758931200 },
];

const log = (...args) => {
  process.stdout.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-api-key, anthropic-version, anthropic-beta, authorization'
  );
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  cors(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function apiError(res, code, message, type = 'api_error') {
  json(res, code, { type: 'error', error: { type, message: String(message) } });
}

function authorized(req) {
  if (!config.apiKey) return true;
  const key = req.headers['x-api-key'] || '';
  const auth = String(req.headers.authorization || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return key === config.apiKey || bearer === config.apiKey;
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(decodeBody(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/**
 * Тело запроса может прийти не в UTF-8: PowerShell 5.1, например, кодирует строку
 * в системную кодировку (cp1251). Пробуем строгий UTF-8, потом cp1251/ibm866.
 */
function decodeBody(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    for (const enc of ['windows-1251', 'ibm866']) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(buf);
      } catch {
        /* пробуем следующую */
      }
    }
    return buf.toString('utf8');
  }
}

async function handleMessages(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return apiError(res, 400, `bad request body: ${err.message}`, 'invalid_request_error');
  }

  const model = body.model || config.defaultModel;
  const stream = Boolean(body.stream);

  const deny = new Set(config.toolDeny.map((n) => n.toLowerCase()));
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter(
    (t) => t && t.name && !deny.has(String(t.name).toLowerCase())
  );
  const emulateTools = tools.length > 0 && config.toolEmulation;
  const toolNames = tools.map((t) => String(t.name));

  const prompt = A.buildPrompt({ ...body, tools });
  if (!prompt.trim()) {
    return apiError(res, 400, 'empty prompt: nothing to send', 'invalid_request_error');
  }

  log(
    `-> /v1/messages model=${model} stream=${stream} chars=${prompt.length} tools=${tools.length}`
  );
  const started = Date.now();

  if (!stream) {
    try {
      const answer = await alice.ask(prompt);
      log(`<- done in ${Date.now() - started}ms chars=${answer.length}`);
      if (emulateTools) {
        const call = A.parseToolCall(answer, toolNames);
        if (call) return json(res, 200, A.buildToolMessage({ model, call }));
      }
      return json(res, 200, A.buildMessage({ model, text: answer }));
    } catch (err) {
      log(`!! error: ${err.message}`);
      return apiError(res, 502, `alice upstream error: ${err.message}`);
    }
  }

  cors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sse = new A.Sse(res, model);
  sse.start();
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  if (emulateTools) {
    // инструменты требуют валидного JSON целиком — копим и отдаём в конце
    try {
      const answer = await alice.ask(prompt);
      log(`<- done in ${Date.now() - started}ms chars=${answer.length}`);
      const call = A.parseToolCall(answer, toolNames);
      if (call) {
        log(`   tool_use: ${call.name} ${JSON.stringify(call.input).slice(0, 200)}`);
        if (call.before) sse.textDelta(call.before);
        sse.blockStop();
        sse.toolStart(call.name);
        sse.toolJsonDelta(JSON.stringify(call.input));
        sse.finish({ stopReason: 'tool_use', outputText: JSON.stringify(call.input) });
      } else {
        sse.textDelta(answer);
        sse.finish({ stopReason: 'end_turn', outputText: answer });
      }
    } catch (err) {
      log(`!! error: ${err.message}`);
      sse.error(err.message);
    }
    return;
  }

  let full = '';
  try {
    const answer = await alice.ask(prompt, {
      onDelta: (delta) => {
        if (closed) return;
        full += delta;
        sse.textDelta(delta);
      },
    });
    log(`<- done in ${Date.now() - started}ms chars=${answer.length}`);
    if (!full && answer) sse.textDelta(answer);
    sse.finish({ stopReason: 'end_turn', outputText: full || answer });
  } catch (err) {
    log(`!! error: ${err.message}`);
    sse.error(err.message);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return json(res, 200, {
      ok: true,
      service: 'alice-anthropic-proxy',
      upstream: config.wsUrl,
      authorized: Boolean(config.cookie),
      model_default: config.defaultModel,
      endpoints: ['POST /v1/messages', 'POST /v1/messages/count_tokens', 'GET /v1/models'],
    });
  }

  if (url.pathname.startsWith('/v1/') && !authorized(req)) {
    return apiError(res, 401, 'invalid api key', 'authentication_error');
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return json(res, 200, {
      data: MODELS.map((m) => ({
        type: 'model',
        id: m.id,
        display_name: m.display_name,
        created_at: new Date(m.created * 1000).toISOString(),
      })),
      has_more: false,
      first_id: MODELS[0].id,
      last_id: MODELS[MODELS.length - 1].id,
    });
  }

  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    return void handleMessages(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
    return readBody(req)
      .then((raw) => {
        const body = JSON.parse(raw || '{}');
        const prompt = A.buildPrompt(body);
        json(res, 200, { input_tokens: A.roughTokens(prompt) });
      })
      .catch((err) => apiError(res, 400, err.message, 'invalid_request_error'));
  }

  return apiError(res, 404, `unknown endpoint ${url.pathname}`, 'not_found_error');
});

server.listen(config.port, config.host, () => {
  log(`alice-anthropic-proxy listening on http://${config.host}:${config.port}`);
  log(`upstream: ${config.wsUrl}`);
  log(`auth cookie: ${config.cookie ? 'set' : 'anonymous mode'}`);
  if (config.apiKey) log('local API key: required (x-api-key / Bearer)');
  else log('local API key: disabled');
});

const shutdown = () => {
  log('shutting down...');
  alice.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
