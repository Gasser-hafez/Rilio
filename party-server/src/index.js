// سيرفر الـ Watch Party على Cloudflare: Worker بيوجّه كل كود أوضة لـ Durable Object واحد
// الـ DO بيستخدم WebSocket Hibernation — مبيتحسبش وقت وهو مستني رسايل
import { DurableObject } from 'cloudflare:workers';
import {
  isRoomCode, parseClientMessage, applyMessage, snapshot, rateLimit, emptyRoom,
  MAX_PEERS, ROOM_IDLE_TTL_MS,
} from '../public/protocol.mjs';

import { SERVER_ORIGINS } from '../public/guest-logic.mjs';

// ملفات صفحة الضيف — قايمة ثابتة، أي مسار تاني 404
const GUEST_FILES = {
  '/guest.js': 'text/javascript; charset=utf-8',
  '/guest-logic.mjs': 'text/javascript; charset=utf-8',
  '/protocol.mjs': 'text/javascript; charset=utf-8',
  '/guest.css': 'text/css; charset=utf-8',
};

// CSP صارمة: سكريبتات من السيرفر ده بس، الاتصال بالأوضة بس، والبلاير من سيرفرات الليستة الثابتة بس
function securityHeaders(host, type) {
  const ws = `wss://${host}` + (/^(127\.0\.0\.1|localhost)(:|$)/.test(host) ? ` ws://${host}` : '');
  return {
    'Content-Type': type,
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${ws}; frame-src ${SERVER_ORIGINS.join(' ')}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Robots-Tag': 'noindex',
    'Cache-Control': 'no-cache',
  };
}

async function serveAsset(env, req, path, type) {
  const url = new URL(req.url);
  const res = await env.ASSETS.fetch(new Request(new URL(path, url.origin), { method: 'GET' }));
  if (!res.ok) return new Response('Not found', { status: 404 });
  return new Response(res.body, { status: 200, headers: securityHeaders(url.host, type) });
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    // صفحة الضيف: /join/ABCD-EFGH (الشرطة اختيارية)
    const j = pathname.match(/^\/join\/([A-Za-z0-9-]{8,9})$/);
    if (j) {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isRoomCode(j[1].toUpperCase().replace(/-/g, ''))) return new Response('Not found', { status: 404 });
      return serveAsset(env, req, '/guest.html', 'text/html; charset=utf-8');
    }
    if (Object.hasOwn(GUEST_FILES, pathname)) {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return serveAsset(env, req, pathname, GUEST_FILES[pathname]);
    }

    const m = pathname.match(/^\/room\/([^/]+)$/);
    if (!m || !isRoomCode(m[1])) return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    // 60 اتصال جديد في الدقيقة لكل IP — كفاية جداً لأي watch party، وبيمنع السيل
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.CONNECT_LIMITER && !(await env.CONNECT_LIMITER.limit({ key: ip })).success) return new Response('Too many connections', { status: 429 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

const send = (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch (e) { /* socket بيتقفل */ } };

export class Room extends DurableObject {
  // الـ sockets المفتوحة بس (اللي بيتقفل ممكن يفضل في الليستة لحظة)
  open() { return this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN); }

  async load() { return (await this.ctx.storage.get('room')) || emptyRoom(); }

  broadcast(msg, except) { for (const ws of this.open()) if (ws !== except) send(ws, msg); }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (this.open().length >= MAX_PEERS) {
      // socket عادي (مش hibernation) عشان ميتحسبش ضمن الأعضاء — رسالة وقفل وخلاص
      server.accept();
      send(server, { t: 'error', code: 'room_full' });
      server.close(4001, 'room_full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ rl: null });
    const peers = this.open().length;
    const now = Date.now();
    send(server, snapshot(await this.load(), now, peers));
    this.broadcast({ t: 'peers', n: peers }, server); // اللي داخل خد العدد في الـ sync
    await this.ctx.storage.setAlarm(now + ROOM_IDLE_TTL_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string') { ws.close(1003, 'text only'); return; }
    const now = Date.now();
    const att = ws.deserializeAttachment() || {};
    const { allowed, rl } = rateLimit(att.rl, now);
    ws.serializeAttachment({ ...att, rl });
    if (!allowed) { send(ws, { t: 'error', code: 'rate_limited' }); return; }

    const parsed = parseClientMessage(data);
    if (!parsed.ok) { send(ws, { t: 'error', code: parsed.code }); return; }
    if (parsed.msg.t === 'ping') { send(ws, { t: 'pong' }); return; }

    const { room, broadcast } = applyMessage(await this.load(), parsed.msg, now);
    if (!broadcast) return;
    await this.ctx.storage.put('room', room);
    this.broadcast(broadcast);
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (e) { /* اتقفل خلاص */ }
    this.broadcast({ t: 'peers', n: this.open().length });
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }

  // أوضة فاضية بقالها 6 ساعات → نمسح حالتها
  async alarm() {
    const room = await this.load();
    if (this.open().length === 0 && Date.now() - room.touched >= ROOM_IDLE_TTL_MS) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
  }
}
