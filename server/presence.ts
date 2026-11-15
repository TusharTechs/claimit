// Who is online right now, fed by Nexconn's `user:connection_status` webhook (or the mock bus locally).
// Used by the claim engine: offline buyers are skipped when an item passes down the line, and a holder who
// leaves the room loses their hold early instead of freezing the item for minutes.

const state = new Map<string, { online: boolean; at: number }>();

export const presence = {
  set(userId: string, online: boolean, at = Date.now()) {
    const cur = state.get(userId);
    if (cur && cur.at > at) return; // ignore out-of-order deliveries
    state.set(userId, { online, at });
  },
  /** true = known online, false = known offline for at least `graceMs`, null = unknown (treat as online). */
  isOffline(userId: string, graceMs = 20_000): boolean {
    const s = state.get(userId);
    return !!s && !s.online && Date.now() - s.at >= graceMs;
  },
  offlineSince(userId: string): number | null {
    const s = state.get(userId);
    return s && !s.online ? s.at : null;
  },
  /** Seen online at least once via the webhook (so we know the feed is configured). */
  known(userId: string) { return state.has(userId); },
};
