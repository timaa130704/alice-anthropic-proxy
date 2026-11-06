'use strict';

const tls = require('node:tls');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/**
 * Минимальный WebSocket-клиент (RFC 6455) поверх TLS.
 * Нужен свой, чтобы прокинуть Cookie/Origin — обычный браузерный
 * конструктор их не даёт, а тянуть зависимости не хочется.
 */
class WsClient extends EventEmitter {
  constructor(url, headers = {}) {
    super();
    this.url = url;
    this.headers = headers;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.open = false;
    this.closed = false;
  }

  connect() {
    const u = new URL(this.url);
    if (u.protocol !== 'wss:') throw new Error('only wss:// supported');

    const key = crypto.randomBytes(16).toString('base64');
    const host = u.hostname;
    const path = (u.pathname || '/') + (u.search || '');

    const socket = tls.connect(
      { host, port: Number(u.port) || 443, servername: host, ALPNProtocols: ['http/1.1'] },
      () => {
        const lines = [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
        ];
        for (const [k, v] of Object.entries(this.headers)) {
          if (v === undefined || v === null || v === '') continue;
          lines.push(`${k}: ${v}`);
        }
        socket.write(lines.join('\r\n') + '\r\n\r\n');
      }
    );

    this.socket = socket;
    let handshakeDone = false;

    socket.on('data', (chunk) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;

      if (!handshakeDone) {
        const idx = this.buffer.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = this.buffer.slice(0, idx).toString('utf8');
        this.buffer = this.buffer.slice(idx + 4);
        const status = head.split('\r\n')[0] || '';
        const m = /^HTTP\/1\.1 (\d{3})/.exec(status);
        const code = m ? Number(m[1]) : 0;
        if (code !== 101) {
          this.emit('error', new Error(`websocket handshake failed: ${status || 'no status'}`));
          this.destroy();
          return;
        }
        const expect = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head);
        if (accept && accept[1] !== expect) {
          this.emit('error', new Error('websocket handshake: bad accept key'));
          this.destroy();
          return;
        }
        handshakeDone = true;
        this.open = true;
        this.emit('open');
      }

      this._drain();
    });

    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => {
      const wasOpen = this.open;
      this.open = false;
      this.closed = true;
      if (wasOpen || !this.closedEmitted) {
        this.closedEmitted = true;
        this.emit('close', { code: 1006, reason: 'socket closed' });
      }
    });
    return this;
  }

  _drain() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.emit('error', new Error('frame too large'));
          this.destroy();
          return;
        }
        len = Number(big);
        offset = 10;
      }

      let mask;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + len) return;

      let payload = this.buffer.slice(offset, offset + len);
      this.buffer = this.buffer.slice(offset + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }

      if (opcode === OP.PING) {
        this._writeFrame(OP.PONG, payload);
        this.emit('ping', payload);
        continue;
      }
      if (opcode === OP.PONG) continue;
      if (opcode === OP.CLOSE) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.slice(2).toString('utf8') : '';
        this._writeFrame(OP.CLOSE, payload.slice(0, 2));
        this.open = false;
        this.emit('close', { code, reason });
        this.destroy();
        return;
      }

      if (opcode === OP.CONT) {
        this.fragments.push(payload);
      } else {
        this.fragments = [payload];
        this.fragmentOpcode = opcode;
      }

      if (!fin) continue;

      const full = Buffer.concat(this.fragments);
      this.fragments = [];
      if (this.fragmentOpcode === OP.TEXT) this.emit('message', full.toString('utf8'));
      else this.emit('binary', full);
    }
  }

  _writeFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2 + 4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4 + 4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10 + 4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    const mask = crypto.randomBytes(4);
    mask.copy(header, header.length - 4);
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) masked[i] = data[i] ^ mask[i & 3];
    try {
      this.socket.write(Buffer.concat([header, masked]));
      return true;
    } catch {
      return false;
    }
  }

  send(text) {
    if (!this.open) return false;
    return this._writeFrame(OP.TEXT, text);
  }

  sendJSON(obj) {
    return this.send(JSON.stringify(obj));
  }

  destroy() {
    this.open = false;
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
  }

  close(code = 1000, reason = 'bye') {
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2, 'utf8');
    this._writeFrame(OP.CLOSE, payload);
    setTimeout(() => this.destroy(), 200).unref?.();
  }
}

module.exports = { WsClient };
