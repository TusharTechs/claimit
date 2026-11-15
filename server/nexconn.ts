// Server-side Nexconn Platform Chat API client (https://docs.nexconn.ai/platform-chat-api).
// Every call is signed with SHA1(AppSecret + Nonce + Timestamp). The App Secret never leaves this process.
import crypto from 'node:crypto';
import { config } from './config.ts';
import { db } from './db.ts';
import { mockbus } from './mockbus.ts';

const { appKey, appSecret, hosts } = config.nexconn;
let hostIdx = 0;

export class NexconnError extends Error {
  constructor(public path: string, public code: number, public body: unknown) {
    super(`Nexconn ${path} failed with code ${code}`);
  }
}

async function call<T = any>(path: string, body: unknown): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = hosts[hostIdx];
    const nonce = String(Math.floor(Math.random() * 1e9));
    const timestamp = String(Date.now());
    const signature = crypto.createHash('sha1').update(appSecret + nonce + timestamp).digest('hex');
    try {
      const res = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: {
          'App-Key': appKey,
          Nonce: nonce,
          Timestamp: timestamp,
          Signature: signature,
          'Content-Type': 'application/json',
          'X-Request-ID': crypto.randomUUID().replace(/-/g, ''),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      const json: any = await res.json().catch(() => ({}));
      if (res.status >= 500) throw new NexconnError(path, res.status, json);
      if (json.code !== 0 && json.code !== 200) throw new NexconnError(path, json.code ?? res.status, json);
      return json as T;
    } catch (e) {
      lastErr = e;
      // Docs: on timeout or unexpected status, switch to the backup domain.
      if (e instanceof NexconnError && e.code < 500) throw e;
      hostIdx = (hostIdx + 1) % hosts.length;
    }
  }
  throw lastErr;
}

const mock = config.mode === 'mock';
const countCache = new Map<string, { n: number; at: number }>();

export const nexconn = {
  mode: config.mode,

  /** Registers the user with Nexconn (if needed) and returns an access token. Cached per user. */
  async token(userId: string, name: string): Promise<string> {
    const cached = db.prepare('SELECT token FROM tokens WHERE user_id = ?').get(userId) as { token: string } | undefined;
    if (cached) return cached.token;
    let token: string;
    if (mock) token = `mock:${userId}`;
    else {
      const res = await call('/v4/auth/access-token/issue', { userId, name: name.slice(0, 64) || userId });
      token = res.result.accessToken;
    }
    db.prepare('INSERT OR REPLACE INTO tokens (user_id, token) VALUES (?, ?)').run(userId, token);
    return token;
  },

  /** Creates the live room. Destroyed after 7 days of inactivity (max allowed). */
  async createOpenChannel(channelId: string) {
    if (mock) return;
    await call('/v4/open-channel/create', { channelId, destroyType: 0, ttlMinutes: 10080 });
  },

  /** Writes shared live state (claim queue per item) into the open channel's metadata; every viewer is notified. */
  async setMetadata(channelId: string, ownerId: string, entries: Record<string, string>) {
    if (mock) return mockbus.setMetadata(channelId, entries);
    await call('/v4/open-channel/metadata/batch/set', {
      channelId, metadataOwnerId: ownerId, shouldAutoDelete: 0, metadata: entries,
    });
  },

  /** Sends to the live room. priority 2 = high (product drops & claim events must land even when chat floods). */
  async sendOpen(channelId: string, fromUserId: string, messageType: string, content: unknown, priority = 2) {
    if (mock) return mockbus.sendOpen(channelId, fromUserId, messageType, content);
    await call('/v4/open-channel/message/send', {
      fromUserId, toChannelIds: [channelId], messageType,
      content: JSON.stringify(content), shouldPersist: 0, isEchoToSender: 1, priority,
    });
  },

  /** 1:1 message (order card, order updates). Echoed to the sender so the seller's inbox shows it too. */
  async sendDirect(fromUserId: string, toUserId: string, messageType: string, content: unknown, pushContent?: string, toMany?: string[]) {
    const to = toMany?.length ? toMany : [toUserId];
    if (mock) { for (const t of to) mockbus.sendDirect(fromUserId, t, messageType, content); return; }
    await call('/v4/direct-channel/message/send', {
      fromUserId, toUserIds: to, messageType,
      content: JSON.stringify(content), isEchoToSender: 1, shouldPersist: 1,
      ...(pushContent ? { pushContent } : {}),
    });
  },

  /** Live number of people in the room. Cached briefly: many viewers poll this. */
  async participantCount(channelId: string): Promise<number | null> {
    const hit = countCache.get(channelId);
    if (hit && Date.now() - hit.at < 5000) return hit.n;
    let n: number | null = null;
    if (mock) n = mockbus.count(channelId);
    else {
      try { n = (await call('/v4/open-channel/get', { channelId })).result?.participantCount ?? null; }
      catch { n = hit?.n ?? null; }
    }
    countCache.set(channelId, { n: n ?? 0, at: Date.now() });
    return n;
  },

  /** One-time app setup: drops/events never get shed; fan chat is shed first under load. */
  async configurePriorities(priorityTypes: string[], lowPriorityTypes: string[]) {
    if (mock) return { skipped: true };
    const out: Record<string, unknown> = {};
    try { out.priority = await call('/v4/open-channel/priority-message-type-list/add', { messageTypes: priorityTypes }); }
    catch (e) { out.priority = String(e instanceof NexconnError ? JSON.stringify(e.body) : e); }
    try { out.low = await call('/v4/open-channel/low-priority-message-type-list/add', { messageTypes: lowPriorityTypes }); }
    catch (e) { out.low = String(e instanceof NexconnError ? JSON.stringify(e.body) : e); }
    return out;
  },
};
