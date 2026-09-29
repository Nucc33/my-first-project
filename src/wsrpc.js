// A small JSON-RPC-over-WebSocket client that reconnects by itself.
// Uses the WebSocket built into Node 22+, so nothing extra to install.
const { log } = require('./util');

class WsRpc {
  constructor({ name, url, keepaliveMethod, keepaliveParams = [], onOpen, onNotification, onStatus }) {
    this.name = name;
    this.url = url;
    this.keepaliveMethod = keepaliveMethod;
    this.keepaliveParams = keepaliveParams;
    this.onOpen = onOpen;
    this.onNotification = onNotification;
    this.onStatus = onStatus || (() => {});
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
    this.stopped = false;
    this.backoff = 1000;
    this.lastMessageAt = 0;
    this.timer = null;
  }

  start() {
    this.stopped = false;
    this._connect();
    this.timer = setInterval(() => this._keepalive(), 30000);
    this.timer.unref();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    this.ws = null;
  }

  // Force a fresh connection (used after the wallet list changes).
  restart() {
    this.stop();
    this.start();
  }

  _connect() {
    if (this.stopped) return;
    this.onStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      log(`${this.name}: cannot open connection: ${e.message}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = async () => {
      this.backoff = 1000;
      this.lastMessageAt = Date.now();
      try {
        await this.onOpen(this);
        this.onStatus('live');
      } catch (e) {
        log(`${this.name}: subscribe failed: ${e.message}`);
        this.onStatus('error', e.message);
        try { ws.close(); } catch {}
      }
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
      const msgs = Array.isArray(msg) ? msg : [msg];
      for (const m of msgs) {
        if (m.id !== undefined && this.pending.has(m.id)) {
          const { resolve, reject, t } = this.pending.get(m.id);
          clearTimeout(t);
          this.pending.delete(m.id);
          if (m.error) reject(new Error(m.error.message || JSON.stringify(m.error)));
          else resolve(m.result);
        } else if (m.method) {
          try { this.onNotification(m); } catch (e) { log(`${this.name}: ${e.message}`); }
        }
      }
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const { reject, t } of this.pending.values()) {
        clearTimeout(t);
        reject(new Error('connection closed'));
      }
      this.pending.clear();
      if (!this.stopped) {
        const why = ev && ev.code ? ` (code ${ev.code}${ev.reason ? ': ' + ev.reason : ''})` : '';
        log(`${this.name}: disconnected${why}, reconnecting...`);
        this.onStatus('reconnecting');
        this._scheduleReconnect();
      }
    };
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 60000);
    setTimeout(() => this._connect(), wait).unref();
  }

  _keepalive() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // No reply for 2 minutes: the connection is probably dead, so start over.
    if (Date.now() - this.lastMessageAt > 120000) {
      log(`${this.name}: connection went quiet, reconnecting...`);
      try { this.ws.close(); } catch {}
      return;
    }
    if (this.keepaliveMethod) this.request(this.keepaliveMethod, this.keepaliveParams).catch(() => {});
  }

  request(method, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('not connected'));
        return;
      }
      const id = this.nextId++;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, t });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
}

module.exports = { WsRpc };
