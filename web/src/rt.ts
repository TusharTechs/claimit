// Real-time layer. In production this is the Nexconn Chat SDK; with no App Key configured it falls back
// to a local mock over server-sent events with the same surface, so the app can be developed offline.
import type { Message } from '@nexconn/chat';
import type { AppConfig } from '../../shared/types';
import { CUSTOM_TYPES, MSG } from '../../shared/types';

export interface RtMessage {
  id: string;
  type: string;
  content: any;
  sender: string;
  kind: 'open' | 'direct';
  channelId: string; // open channel id, or the peer user id for direct messages
  time: number;
  mine: boolean;
}

type MsgFn = (m: RtMessage) => void;
type MetaFn = (channelId: string, changes: { key: string; value: string | null }[]) => void;
type CountFn = (channelId: string, count: number) => void;
type StatusFn = (connected: boolean) => void;

interface Transport {
  connect(token: string, userId: string): Promise<void>;
  enterOpen(channelId: string): Promise<{ count: number; metadata: Record<string, string> }>;
  exitOpen(channelId: string): Promise<void>;
  sendOpen(channelId: string, type: string, content: unknown): Promise<RtMessage | null>;
  sendDirect(peerId: string, type: string, content: unknown): Promise<RtMessage | null>;
  history(peerId: string): Promise<RtMessage[]>;
}

const listeners = { msg: new Set<MsgFn>(), meta: new Set<MetaFn>(), count: new Set<CountFn>(), status: new Set<StatusFn>() };
const emit = {
  msg: (m: RtMessage) => listeners.msg.forEach((f) => f(m)),
  meta: (c: string, ch: { key: string; value: string | null }[]) => listeners.meta.forEach((f) => f(c, ch)),
  count: (c: string, n: number) => listeners.count.forEach((f) => f(c, n)),
  status: (ok: boolean) => listeners.status.forEach((f) => f(ok)),
};

// ---------- Nexconn transport ----------

// The SDK is loaded on demand so the mock/dev build and first paint stay light on mobile data.
async function nexconnTransport(cfg: AppConfig): Promise<Transport> {
  const {
    BaseChannel, ConnectionStatusHandler, DirectChannel, DirectChannelIdentifier, MessageHandler, NCEngine,
    OpenChannel, OpenChannelHandler, SendMessageParams, SendTextMessageParams, AreaCode, LogLevel, ChannelType,
  } = await import('@nexconn/chat');
  let me = '';
  const area = (AreaCode as Record<string, any>)[cfg.area] ?? AreaCode.SG;
  NCEngine.initialize({ appKey: cfg.appKey!, areaCode: area, logLevel: LogLevel.WARN });
  NCEngine.registerCustomMessages([
    { messageType: MSG.DROP, isPersisted: false, isCounted: false },
    { messageType: MSG.EVENT, isPersisted: false, isCounted: false },
    { messageType: MSG.CHAT, isPersisted: false, isCounted: false },
    { messageType: MSG.ORDER, isPersisted: true, isCounted: true },
    { messageType: MSG.ORDER_UPDATE, isPersisted: true, isCounted: true },
  ]);

  const toRt = (m: Message): RtMessage => {
    const ci = m.channelIdentifier;
    const kind = ci.channelType === ChannelType.OPEN ? 'open' : 'direct';
    let content: any = m.content;
    if (typeof content === 'string') { try { content = JSON.parse(content); } catch { /* keep */ } }
    return {
      id: m.messageId || String(m.clientId), type: m.messageType, content,
      sender: m.senderUserId, kind, channelId: ci.channelId, time: m.sentTime || Date.now(), mine: m.senderUserId === me,
    };
  };

  NCEngine.addConnectionStatusHandler('claimit', new ConnectionStatusHandler({
    onConnectionStatusChanged({ status }) { emit.status(status === 0 || String(status).toLowerCase() === 'connected'); },
  }));
  NCEngine.addMessageHandler('claimit', new MessageHandler({
    onMessageReceived({ messages }) {
      for (const m of messages) {
        const t = m.channelIdentifier.channelType;
        if (t === ChannelType.OPEN || t === ChannelType.DIRECT) emit.msg(toRt(m));
      }
    },
  }));
  NCEngine.addOpenChannelHandler('claimit', new OpenChannelHandler({
    onMetadataChanged({ changeInfo }) {
      const by = new Map<string, { key: string; value: string | null }[]>();
      for (const c of changeInfo) {
        if (!by.has(c.channelId)) by.set(c.channelId, []);
        by.get(c.channelId)!.push({ key: c.key, value: c.operationType === 1 ? null : c.value });
      }
      by.forEach((ch, id) => emit.meta(id, ch));
    },
    onParticipantChanged({ channelId, participantCount }) { emit.count(channelId, participantCount); },
  }));

  return {
    async connect(token, userId) {
      me = userId;
      const res = await NCEngine.connect({ token });
      if (!res.isOk) throw new Error(`Nexconn connect failed (code ${res.code})`);
      emit.status(true);
    },
    async enterOpen(channelId) {
      const ch = new OpenChannel(channelId);
      const res = await ch.enterChannel({ messageCount: 20 });
      if (!res.isOk) throw new Error(`Could not join the live room (code ${res.code})`);
      const meta = await ch.getMetadata();
      return { count: res.data?.participantCount ?? 1, metadata: meta.isOk ? meta.data || {} : {} };
    },
    async exitOpen(channelId) { await new OpenChannel(channelId).exitChannel(); },
    async sendOpen(channelId, type, content) {
      const res = await new OpenChannel(channelId).sendMessage(new SendMessageParams(content as Record<string, any>, type));
      return res.isOk && res.data ? toRt(res.data) : null;
    },
    async sendDirect(peerId, type, content) {
      const ch = new DirectChannel(peerId);
      const res = type === MSG.TEXT
        ? await ch.sendMessage(new SendTextMessageParams({ text: (content as { text: string }).text }))
        : await ch.sendMessage(new SendMessageParams(content as Record<string, any>, type) as any);
      return res.isOk && res.data ? toRt(res.data) : null;
    },
    async history(peerId) {
      const query = BaseChannel.createMessagesQuery({
        channelIdentifier: new DirectChannelIdentifier(peerId), startTime: Date.now(), pageSize: 50, isAscending: false,
      });
      const res = await query.loadNextPage();
      if (!res.isOk || !res.data) return [];
      const list = (res.data as any).data ?? (res.data as any).list ?? res.data;
      return (Array.isArray(list) ? list : []).map(toRt).sort((a: RtMessage, b: RtMessage) => a.time - b.time);
    },
  };
}

// ---------- mock transport ----------

function mockTransport(): Transport {
  let token = '';
  let me = '';
  const post = (path: string, body: unknown) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mock-token': token }, body: JSON.stringify(body) })
      .then((r) => r.json());
  const toRt = (m: any): RtMessage => ({
    id: m.messageId, type: m.messageType, content: m.content, sender: m.senderUserId,
    kind: m.channelType, channelId: m.channelId, time: m.sentTime, mine: m.senderUserId === me,
  });
  return {
    connect(t, userId) {
      token = t; me = userId;
      return new Promise((resolve) => {
        const es = new EventSource(`/api/mock/stream?token=${encodeURIComponent(t)}`);
        es.onopen = () => { emit.status(true); resolve(); };
        es.onerror = () => emit.status(false);
        es.onmessage = (ev) => {
          const p = JSON.parse(ev.data);
          if (p.type === 'message') emit.msg(toRt(p.message));
          else if (p.type === 'metadata') emit.meta(p.channelId, p.changes);
          else if (p.type === 'participants') emit.count(p.channelId, p.count);
        };
      });
    },
    async enterOpen(channelId) {
      const r = await post('/api/mock/enter', { channelId });
      return { count: r.participantCount, metadata: r.metadata };
    },
    async exitOpen(channelId) { await post('/api/mock/exit', { channelId }); },
    async sendOpen(channelId, type, content) {
      await post('/api/mock/send-open', { channelId, type, content });
      return null; // mock echoes to sender through the stream
    },
    async sendDirect(peerId, type, content) {
      await post('/api/mock/send-direct', { to: peerId, type, content });
      return null;
    },
    async history(peerId) {
      const r = await fetch(`/api/mock/history?peer=${encodeURIComponent(peerId)}`, { headers: { 'x-mock-token': token } }).then((x) => x.json());
      return (r as any[]).map(toRt);
    },
  };
}

// ---------- public API ----------

let transport: Transport | null = null;
let transportPromise: Promise<Transport> | null = null;
let cfgPromise: Promise<AppConfig> | null = null;
let connected: { userId: string; promise: Promise<void> } | null = null;

// Resolves once the first successful connection is up. Every channel call waits on it, so UI pieces
// (e.g. an order chat opened while the phone is still connecting) can never hit an uninitialised SDK.
let markReady: (t: Transport) => void;
const readyPromise = new Promise<Transport>((r) => { markReady = r; });
const ready = () => readyPromise;

export const rt = {
  config(): Promise<AppConfig> {
    cfgPromise ??= fetch('/api/config').then((r) => r.json());
    return cfgPromise;
  },
  connect(token: string, userId: string): Promise<void> {
    if (connected?.userId === userId) return connected.promise;
    if (connected) return Promise.reject(new Error('Already connected as another user in this tab. Reload to switch.'));
    // Set `connected` synchronously so concurrent callers share one SDK init + connect.
    const promise = (async () => {
      const cfg = await rt.config();
      transportPromise ??= cfg.mode === 'nexconn' && cfg.appKey ? nexconnTransport(cfg) : Promise.resolve(mockTransport());
      transport = await transportPromise;
      await transport.connect(token, userId);
      markReady(transport);
    })();
    connected = { userId, promise };
    promise.catch(() => { connected = null; });
    return promise;
  },
  get me() { return connected?.userId ?? null; },
  enterOpen: async (id: string) => (await ready()).enterOpen(id),
  exitOpen: async (id: string) => { if (transport) await transport.exitOpen(id); },
  sendOpen: async (id: string, type: string, content: unknown) => (await ready()).sendOpen(id, type, content),
  sendDirect: async (peer: string, type: string, content: unknown) => (await ready()).sendDirect(peer, type, content),
  history: async (peer: string) => (await ready()).history(peer),
  onMessage(fn: MsgFn) { listeners.msg.add(fn); return () => { listeners.msg.delete(fn); }; },
  onMetadata(fn: MetaFn) { listeners.meta.add(fn); return () => { listeners.meta.delete(fn); }; },
  onParticipants(fn: CountFn) { listeners.count.add(fn); return () => { listeners.count.delete(fn); }; },
  onStatus(fn: StatusFn) { listeners.status.add(fn); return () => { listeners.status.delete(fn); }; },
};

export { CUSTOM_TYPES };
