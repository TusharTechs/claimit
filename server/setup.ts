// One-time Nexconn app setup. Run after putting NEXCONN_APP_KEY / NEXCONN_APP_SECRET in .env:
//   npm run setup:nexconn
// Requires these services to be enabled in the Nexconn Console for your App Key:
//   - Open channel metadata (KV)            -> live claim queue
//   - Open channel message priority          -> low-priority fan chat
//   - Open channel allowlist / priority types -> product drops are never dropped
import { config } from './config.ts';
import { nexconn } from './nexconn.ts';
import { MSG } from '../shared/types.ts';

if (config.mode !== 'nexconn') {
  console.error('No NEXCONN_APP_KEY / NEXCONN_APP_SECRET in .env — nothing to configure.');
  process.exit(1);
}

const result = await nexconn.configurePriorities([MSG.DROP, MSG.EVENT], [MSG.CHAT]);
console.log(JSON.stringify(result, null, 2));
console.log('Done. If either call returned an error code like 1009, enable that service in the Nexconn Console and re-run.');
