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

/** True when the request never reached Nexconn (DNS / connection refused), so a retry can't create a duplicate. */
const neverSent = (e: unknown) => {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? '';
  return ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
};

/** Signed Platform API call. Message sends are not idempotent, so they only fail over when the request never left. */
async function call<T = any>(path: string, body: unknown, idempotent = true): Promise<T> {
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
      if (!idempotent && !neverSent(e)) throw e; // it may have been delivered: don't send it twice
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

  /**
   * Sends to the live room. Load shedding works on two levels: message *types* (CI:Drop/CI:Event are registered as
   * priority types, CI:Chat as a low-priority type by `npm run setup:nexconn`) and the per-message `priority` flag,
   * which we set to 2 (high) for every server-sent drop and claim event. Chat is sent without the flag.
   */
  async sendOpen(channelId: string, fromUserId: string, messageType: string, content: unknown, priority?: number) {
    if (mock) return mockbus.sendOpen(channelId, fromUserId, messageType, content);
    await call('/v4/open-channel/message/send', {
      fromUserId, toChannelIds: [channelId], messageType,
      content: JSON.stringify(content), shouldPersist: 0, isEchoToSender: 1, ...(priority !== undefined ? { priority } : {}),
    }, false);
  },

  /** 1:1 message (order card, order updates). Echoed to the sender so the seller's inbox shows it too. */
  /** Returns the message id for single-recipient sends (used to update the message's metadata later). */
  async sendDirect(fromUserId: string, toUserId: string, messageType: string, content: unknown, pushContent?: string, toMany?: string[],
    metadata?: Record<string, string>): Promise<string | null> {
    const to = toMany?.length ? toMany : [toUserId];
    if (mock) { let id: string | null = null; for (const t of to) id = mockbus.sendDirect(fromUserId, t, messageType, content, metadata); return id; }
    const res = await call('/v4/direct-channel/message/send', {
      fromUserId, toUserIds: to, messageType,
      content: JSON.stringify(content), isEchoToSender: 1, shouldPersist: 1,
      ...(pushContent ? { pushContent } : {}),
      ...(metadata ? { hasMetadata: true, metadata } : {}),
    }, false);
    return res?.result?.messageIds?.[0]?.messageId ?? null;
  },

  /** Update a sent 1:1 message's metadata in place (e.g. the order card's live status). */
  async setMessageMetadata(messageId: string, operatorId: string, peerId: string, metadata: Record<string, string>) {
    if (mock) return mockbus.setMessageMetadata(messageId, operatorId, peerId, metadata);
    await call('/v4/channel-type/message/metadata/set', {
      messageId, userId: operatorId, channelType: 1, channelId: peerId, metadata, isEchoToSender: 1,
    });
  },

  /** Mute someone in one room (Nexconn native moderation): their messages are refused by Nexconn itself. */
  async muteParticipant(channelId: string, userId: string, minutes: number) {
    if (mock) return mockbus.mute(channelId, userId, minutes);
    await call('/v4/open-channel/participant/mute-list/add', { channelId, participantIds: [userId], durationMinutes: Math.min(minutes, 43_200) });
  },

  /** Ban from a room: removes them immediately and blocks rejoining for the duration. */
  async banParticipant(channelId: string, userIds: string[], minutes: number) {
    if (mock || !userIds.length) return;
    await call('/v4/open-channel/participant/ban-list/add', { channelId, participantIds: userIds.slice(0, 20), durationMinutes: Math.min(minutes, 43_200) });
  },

  /** Invalidate every token issued to these users before now: they can't reconnect once disconnected. */
  async expireTokens(userIds: string[]) {
    if (mock || !userIds.length) return;
    await call('/v4/auth/access-token/expire', { userIds: userIds.slice(0, 20), expiresAt: Date.now() });
  },

  /** Free open-channel metadata keys (each channel holds at most 100). */
  async removeMetadata(channelId: string, ownerId: string, keys: string[]) {
    if (!keys.length) return;
    if (mock) return mockbus.removeMetadata(channelId, keys);
    await call('/v4/open-channel/metadata/batch/remove', { channelId, metadataOwnerId: ownerId, metadataKeys: keys });
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
