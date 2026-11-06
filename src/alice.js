'use strict';

const crypto = require('node:crypto');
const { WsClient } = require('./ws');
const P = require('./protocol');
const config = require('./config');

const ID = () => crypto.randomUUID();

function logFrame(dir, obj) {
  if (!config.verbose) return;
  try {
    process.stderr.write(`[alice:${dir}] ${JSON.stringify(obj).slice(0, 6000)}\n`);
  } catch {
    /* ignore */
  }
}

const clientTime = () => new Date().toISOString().slice(0, 19).replace(/[:+-]/g, '');
const isHeader = (h, ns, name) => h && h.namespace === ns && h.name === name;

/** Текст из директивы посимвольной печати (старый путь). */
function textFromDirective(d) {
  if (d?.name !== 'print_text_in_message_view') return null;
  const p = d.payload || {};
  if (typeof p.text !== 'string') return null;
  return { text: p.text, status: p.status };
}

/** Текст карточки ответа: обычный text_card или структурированный блок Alice AI. */
function cardText(card) {
  if (!card || typeof card !== 'object') return null;
  const simple = card.text_card?.text;
  if (typeof simple === 'string' && simple.trim()) return simple;
  const structured = card.neuro_structured_blocks_card?.plain_text;
  if (typeof structured === 'string' && structured.trim()) return structured;
  if (typeof card.text === 'string' && card.text.trim()) return card.text;
  const rich = card.rich_uicard;
  if (rich && typeof rich.text === 'string' && rich.text.trim()) return rich.text;
  return null;
}

/** Текст из базового ответа (json_response.base_response) — основной путь Alice AI. */
function textFromBaseResponse(br) {
  if (!br) return null;
  if (typeof br.text === 'string' && br.text.trim()) return br.text;
  if (Array.isArray(br.cards)) {
    for (const card of br.cards) {
      const t = cardText(card);
      if (t) return t;
    }
  }
  return null;
}

class AliceClient {
  constructor() {
    this.ws = null;
    this.connecting = null;
    this.seq = 1;
    this.uuid = config.uuid || ID();
    this.deviceId = config.deviceId || this.uuid;
    this.dialogId = ID(); // сервер заменит своим, мы запомним
    this.prevReqId = '';
    this.queue = Promise.resolve();
    this.pending = new Map();
  }

  async _connect() {
    if (this.ws && this.ws.open) return this.ws;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const headers = {
        Origin: config.origin,
        'User-Agent': config.userAgent,
        'Accept-Language': 'ru,en;q=0.9',
        Pragma: 'no-cache',
      };
      if (config.cookie) headers.Cookie = config.cookie;

      const ws = new WsClient(config.wsUrl, headers);
      const timer = setTimeout(() => {
        ws.destroy();
        reject(new Error('uniproxy connect timeout'));
      }, 20000);
      timer.unref?.();

      ws.once('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        ws.on('message', (raw) => this._onMessage(raw));
        ws.on('error', (err) => logFrame('error', { message: String(err.message || err) }));
        ws.on('close', () => {
          if (this.ws === ws) this.ws = null;
        });
        this._sync();
        resolve(ws);
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.connect();
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  _sync() {
    const payload = P.syncPayload({
      appId: config.appId,
      platform: config.platform,
      uuid: this.uuid,
      deviceId: this.deviceId,
      deviceModel: config.deviceModel,
      deviceFirmware: config.deviceFirmware,
      features: P.SUPPORTED_FEATURES,
      experiments: P.EXPERIMENTS,
    });
    payload.auth_token = config.apiKeyUpstream;
    if (config.icookie) payload.icookie = config.icookie;

    const msg = {
      event: {
        header: { namespace: 'System', name: 'SynchronizeState', seqNumber: 1, messageId: ID() },
        payload,
      },
    };
    this.seq = 2;
    logFrame('>', msg);
    this.ws.sendJSON(msg);
  }

  _pong(refMessageId) {
    const msg = {
      event: {
        header: { namespace: 'System', name: 'Pong', messageId: ID(), refMessageId },
        payload: {},
      },
    };
    logFrame('>', msg);
    this.ws?.sendJSON(msg);
  }

  _onMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    logFrame('<', frame);

    if (frame?.streamcontrol) {
      for (const h of this.pending.values()) h.onStreamControl?.();
      return;
    }

    const directive = frame?.directive;
    if (!directive) return;
    const header = directive.header || {};
    const payload = directive.payload || {};

    if (isHeader(header, 'System', 'Ping') || isHeader(header, 'System', 'KeepAlive')) {
      this._pong(header.messageId);
      return;
    }
    if (isHeader(header, 'System', 'EventException') || isHeader(header, 'System', 'InvalidAuth')) {
      const err = new Error(
        `alice: ${JSON.stringify(payload?.error || payload || {}).slice(0, 400)}`
      );
      for (const h of this.pending.values()) h.onError?.(err);
      return;
    }

    // запоминаем актуальный dialog_id (сервер может вернуть свой)
    const dialogId =
      header.dialog_id || payload?.header?.dialog_id || payload?.response?.header?.dialog_id;
    if (typeof dialogId === 'string' && dialogId) this.dialogId = dialogId;

    const requestId =
      payload?.header?.request_id || payload?.json_response?.request_id || header.request_id;
    const handler = requestId ? this.pending.get(requestId) : this.pending.values().next().value;
    if (!handler) return;

    // 1) прогрессивный ответ Alice AI
    const jsonResponse = payload?.json_response;
    if (jsonResponse?.base_response) {
      const text = textFromBaseResponse(jsonResponse.base_response);
      if (typeof text === 'string' && text) handler.onText?.(text);
      if (jsonResponse.is_last) handler.onEnd?.();
      return;
    }

    // 2) VinsResponse: снапшот + директивы печати
    if (isHeader(header, 'Vins', 'VinsResponse') || isHeader(header, 'Vins', 'DeferredAliceResponse')) {
      const response = payload?.response || {};
      const directives = [
        ...(response.response?.directives || []),
        ...(response.json_response?.base_response?.directives || []),
      ];
      let gotText = false;
      for (const d of directives) {
        const t = textFromDirective(d);
        if (!t) continue;
        gotText = true;
        handler.onText?.(t.text);
        if (String(t.status) === 'end') handler.onEnd?.();
      }
      if (!gotText) {
        const snapshot = textFromBaseResponse(response.response?.base_response);
        if (typeof snapshot === 'string' && snapshot) {
          handler.onText?.(snapshot);
          handler.onEnd?.();
        }
      }
    }
  }

  async _ensureConnected(attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        await this._connect();
        return;
      } catch (err) {
        lastErr = err;
        this.close();
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
    throw lastErr || new Error('uniproxy connect failed');
  }

  ask(text, { onDelta } = {}) {
    const run = () => this._ask(text, onDelta);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async _ask(text, onDelta) {
    await this._ensureConnected();

    if (!config.keepDialog) {
      // Anthropic-клиенты присылают всю историю в messages — держим запросы независимыми
      this.dialogId = ID();
      this.prevReqId = '';
    }

    const requestId = ID();
    const prevReqId = this.prevReqId;

    const payload = P.textInputPayload({
      appId: config.appId,
      appVersion: config.appVersion,
      platform: config.platform,
      userAgent: config.userAgent,
      uuid: this.uuid,
      deviceId: this.deviceId,
      deviceModel: config.deviceModel,
      deviceFirmware: config.deviceFirmware,
      lang: config.lang,
      timezone: config.timezone,
      clientTime: clientTime(),
      timestamp: String(Date.now()).slice(0, -3),
      requestId,
      prevReqId,
      dialogId: this.dialogId,
      text,
      mode: config.mode,
      features: P.SUPPORTED_FEATURES,
      experiments: P.EXPERIMENTS,
      bassUrl: config.bassUrl,
      icookie: config.icookie,
    });

    const msg = {
      event: {
        header: {
          namespace: 'Vins',
          name: 'TextInput',
          messageId: requestId,
          seqNumber: this.seq++,
        },
        payload,
      },
    };

    let sent = '';
    let ended = false;
    let resolveAsk;
    let lastError = null;
    let finishTimer = null;

    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (finishTimer) clearTimeout(finishTimer);
      this.pending.delete(requestId);
      this.prevReqId = requestId;
      resolveAsk(sent);
    };

    const done = new Promise((res) => {
      resolveAsk = res;
    });

    const timer = setTimeout(() => {
      if (ended) return;
      if (sent) finish();
      else {
        ended = true;
        this.pending.delete(requestId);
        resolveAsk('');
      }
    }, config.requestTimeoutMs);
    timer.unref?.();

    this.pending.set(requestId, {
      onText: (chunk) => {
        const normalized = String(chunk ?? '');
        if (!normalized) return;
        if (normalized.startsWith(sent)) {
          const delta = normalized.slice(sent.length);
          if (delta) onDelta?.(delta);
          sent = normalized;
        } else {
          onDelta?.(normalized);
          sent += normalized;
        }
      },
      onEnd: () => {
        // даём доехать остаткам кадров
        finishTimer = setTimeout(finish, 50);
        finishTimer.unref?.();
      },
      onStreamControl: () => {
        if (sent) {
          finishTimer = setTimeout(finish, 100);
          finishTimer.unref?.();
        }
      },
      onError: (err) => {
        this.pending.delete(requestId);
        if (!ended) {
          ended = true;
          clearTimeout(timer);
          lastError = err;
          resolveAsk('');
        }
      },
    });

    logFrame('>', msg);
    if (!this.ws || !this.ws.open) await this._connect();
    this.ws.sendJSON(msg);

    const result = await done;
    if (lastError) throw lastError;
    return result;
  }

  resetDialog() {
    this.dialogId = ID();
    this.prevReqId = '';
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

module.exports = { AliceClient };
