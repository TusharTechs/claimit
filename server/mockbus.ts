// Local stand-in for Nexconn used only when no App Key/Secret is configured.
// It mimics the three things ClaimIt uses: open-channel messages, open-channel metadata, and direct messages.
import type { Response } from 'express';
import { presence } from './presence.ts';

export interface MockMessage {
  metadata?: Record<string, string>;
  messageId: string;
  messageType: string;
  content: unknown;
  senderUserId: string;
  channelType: 'open' | 'direct';
  channelId: string; // open channel id, or for direct: the peer user id from the receiver's point of view
  sentTime: number;
}

const streams = new Map<string, Set<Response>>();
const openMembers = new Map<string, Set<string>>();
const metadata = new Map<string, Record<string, string>>();
const directHistory = new Map<string, MockMessage[]>(); // key: sorted pair

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

function push(userId: string, payload: unknown) {
  const set = streams.get(userId);
  if (!set) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(data);
}

export const mockbus = {
  attach(userId: string, res: Response) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(': connected\n\n');
    if (!streams.has(userId)) streams.set(userId, new Set());
    streams.get(userId)!.add(res);
    presence.set(userId, true);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => {
      clearInterval(ping);
      streams.get(userId)?.delete(res);
      if (!streams.get(userId)?.size) {
        streams.delete(userId);
        presence.set(userId, false);
        for (const [channelId, members] of openMembers) {
          if (members.delete(userId)) this.participants(channelId);
        }
      }
    });
  },

  enter(channelId: string, userId: string) {
    for (const [cid, members] of openMembers) if (cid !== channelId && members.delete(userId)) this.participants(cid);
    if (!openMembers.has(channelId)) openMembers.set(channelId, new Set());
    openMembers.get(channelId)!.add(userId);
    this.participants(channelId);
    return { participantCount: openMembers.get(channelId)!.size, metadata: metadata.get(channelId) || {} };
  },

  exit(channelId: string, userId: string) {
    if (openMembers.get(channelId)?.delete(userId)) this.participants(channelId);
  },

  count(channelId: string) {
    return openMembers.get(channelId)?.size ?? 0;
  },

  participants(channelId: string) {
    const members = openMembers.get(channelId);
    if (!members) return;
    for (const uid of members) push(uid, { type: 'participants', channelId, count: members.size });
  },

  sendOpen(channelId: string, fromUserId: string, messageType: string, content: unknown) {
    const msg: MockMessage = {
      messageId: nextId(), messageType, content, senderUserId: fromUserId,
      channelType: 'open', channelId, sentTime: Date.now(),
    };
    for (const uid of openMembers.get(channelId) || []) push(uid, { type: 'message', message: msg });
    return msg.messageId;
  },

  setMetadata(channelId: string, entries: Record<string, string>) {
    const cur = metadata.get(channelId) || {};
    Object.assign(cur, entries);
    metadata.set(channelId, cur);
    const changes = Object.entries(entries).map(([key, value]) => ({ key, value }));
    for (const uid of openMembers.get(channelId) || []) push(uid, { type: 'metadata', channelId, changes });
  },

  getMetadata(channelId: string) {
    return metadata.get(channelId) || {};
  },

  sendDirect(fromUserId: string, toUserId: string, messageType: string, content: unknown, metadata?: Record<string, string>) {
    const base = { messageId: nextId(), messageType, content, senderUserId: fromUserId, channelType: 'direct' as const, sentTime: Date.now(), ...(metadata ? { metadata } : {}) };
    const key = pairKey(fromUserId, toUserId);
    const hist = directHistory.get(key) || [];
    hist.push({ ...base, channelId: '' });
    directHistory.set(key, hist.slice(-200));
    push(toUserId, { type: 'message', message: { ...base, channelId: fromUserId } });
    push(fromUserId, { type: 'message', message: { ...base, channelId: toUserId } });
    return base.messageId;
  },

  setMessageMetadata(messageId: string, a: string, b: string, metadata: Record<string, string>) {
    const m = (directHistory.get(pairKey(a, b)) || []).find((x) => x.messageId === messageId);
    if (m) m.metadata = { ...(m.metadata || {}), ...metadata };
    push(a, { type: 'msgmeta', messageId, channelId: b, metadata });
    push(b, { type: 'msgmeta', messageId, channelId: a, metadata });
  },

  history(userId: string, peerId: string): MockMessage[] {
    return (directHistory.get(pairKey(userId, peerId)) || []).map((m) => ({ ...m, channelId: peerId }));
  },

  peers(userId: string): string[] {
    const out: string[] = [];
    for (const key of directHistory.keys()) {
      const [a, b] = key.split('|');
      if (a === userId) out.push(b);
      else if (b === userId) out.push(a);
    }
    return out;
  },
};
