import raw from './data.json';

export interface Activity { t: number; dir: 'api' | 'webhook'; what: string; ms?: number; code?: number | string; note?: string }
export interface Trace { t: number; actor: string; kind: string; d: Record<string, unknown> }
export const data = raw as unknown as {
  run: string; mode: string; marks: Record<string, number>; names: Record<string, string>;
  facts: { race?: { winner: string; first: string; second: string; winners: number; spreadMs?: number; taps?: Record<string, number> } } & Record<string, unknown>;
  traces: Trace[]; activity: Activity[]; vo: Record<string, number>; voText: Record<string, string>;
  tests: { race: string[]; billing: string[]; webhooks: string[] };
};
/** A mark's time in ms from the start of the recording. */
export const M = (name: string, off = 0) => (data.marks[name] ?? 0) + off;
export const has = (name: string) => name in data.marks;
export const actorOf = (person: string) => Object.entries(data.names).find(([, n]) => n === person)?.[0] ?? 'buyer1';
