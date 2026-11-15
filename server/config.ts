import 'dotenv/config';
import path from 'node:path';

const AREA_HOSTS: Record<string, [string, string]> = {
  SG: ['api.sg-light-api.com', 'api-b.sg-light-api.com'],
  NA: ['api.us-light-api.com', 'api-b.us-light-api.com'],
  SA: ['api.sau-light-api.com', 'api-b.sau-light-api.com'],
};

const appKey = process.env.NEXCONN_APP_KEY?.trim() || '';
const appSecret = process.env.NEXCONN_APP_SECRET?.trim() || '';
const area = (process.env.NEXCONN_AREA || 'SG').toUpperCase();

export const config = {
  port: Number(process.env.PORT || 8787),
  dataDir: process.env.DATA_DIR || path.resolve('data'),
  publicUrl: process.env.PUBLIC_URL || '',
  /** Seconds a claimer has to pay before the next person in the waitlist is promoted. */
  holdSeconds: Number(process.env.HOLD_SECONDS || 300),
  maxWaitlist: Number(process.env.MAX_WAITLIST || 5),
  nexconn: {
    appKey,
    appSecret,
    area,
    hosts: AREA_HOSTS[area] || AREA_HOSTS.SG,
  },
  /** With no Nexconn keys the app runs in a local mock mode (server-sent events) so it can be developed offline. */
  mode: (appKey && appSecret ? 'nexconn' : 'mock') as 'nexconn' | 'mock',
};
