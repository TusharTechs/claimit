# ClaimIt

**Fair live drops for social sellers.** "Comment MINE to buy" turns into a first-come claim queue that every viewer can see. It ends in a paid order.

Millions of social sellers run live sales on Instagram, TikTok, Facebook, YouTube and WhatsApp: thrift stores, boutiques, jewellers, plant shops and collectors, from the US to the Philippines to India. Their checkout is still "comment SOLD" or "comment MINE". That means scrolling comments, double claims, fights over who was first, and chasing payment in DMs. ClaimIt replaces that with:

1. **One link.** The seller shares it to their story or group. Buyers join in a tap, with no app and no password.
2. **One Claim button.** The first tap wins. Everyone sees "Held by Priya · 4:12 · 2 in line".
3. **Checkout in chat.** The winner gets a private order chat with the seller's payment link (PayPal, Stripe, GCash, UPI and others) and a timer. If they don't pay in time, the next person in line is promoted automatically, live, in front of the room.

## How it uses Nexconn

| Feature | Nexconn capability |
|---|---|
| Live drop room for any number of viewers | **Open channel**, created server-side for each drop and joined through the Web Chat SDK |
| Live claim queue that every viewer sees update at the same moment | **Open channel metadata (KV)**, written by the server arbiter with per-item versions; clients use `onMetadataChanged` |
| Drops and claim events always get through, fan chat is dropped first under load | **Priority message types** (`CI:Drop`, `CI:Event`) plus a **low-priority type** (`CI:Chat`), registered by `npm run setup:nexconn`; server sends use `priority: 2` |
| Anti-scam room chat: phone numbers, emails and payment handles masked, sender names forced to their real value, and repeat offenders muted after 3 attempts | **Pre-message webhook** (`open_channel:pre_messaging`): Nexconn holds each message until our server passes, rewrites or blocks it |
| Order cards can't be forged, and buyers can't DM each other ("pay me instead" scams on people in line) | **Pre-message webhook** (`direct_channel:pre_messaging`): only shops may send `CI:*`, and every DM must involve a shop |
| The seller answers the room live, with quick replies | Open channel chat, shown to buyers with a server-verified Seller badge |
| Presence-aware queue: buyers who have been offline for 2+ minutes are skipped (and told why). A holder who disconnects for 3+ minutes without opening the payment page loses the hold early, but only if someone is waiting | **User connection-status webhook** (`user:connection_status`) |
| Order card whose status updates in place (waiting for payment, then paid, then confirmed) | **Direct channel** custom message `CI:Order`, sent with `hasMetadata`; the server updates it through **message metadata** (`/v4/channel-type/message/metadata/set`), and clients use `onMessageMetadataUpdated` |
| Buyer and seller order chat | Direct channel: text through the SDK, plus `CI:OrderUpd` status messages |
| Seller inbox on desktop | **Nexconn Chat UI** (`@nexconn/chatui`), with custom Web Component bubbles that render live order cards |
| Followers notified when a shop opens a new drop | Direct channel batch send (up to 1,000 recipients per call) |
| Live viewer count | `/v4/open-channel/get` (server, cached for 5s) plus participant events |
| Demo room's "next item in 6s" countdown | Open channel metadata (`drop.nextAt`) |
| Identity | Server-issued **access tokens**. The App Secret never reaches the browser. |

The **claim arbiter** runs on the app server. Every state change is a single synchronous SQLite transaction in one Node process, so two buyers who tap in the same millisecond can never both win. After each commit, the server publishes the new queue to the open channel's metadata, sends a priority event to the room, and sends or updates the winner's order card.

Prove it: with the mock server running, `npm run test:race` fires 200 simultaneous claims at one item and checks for exactly one winner, a gap-free waitlist in tap order, a public state that matches what each buyer was told, and correct promotion when the winner lets go.

**Reliability details:**

- Metadata writes are versioned and idempotent, so they're retried with backoff. On boot, the server republishes every live drop's state. Message sends are not retried on the backup host unless the request never left, so nothing is delivered twice.
- An order card whose send failed is sent again once. A sold or "buyer says paid" item can't be pulled or re-sold.
- A claim whose buyer says they paid is never auto-released, because money may have moved. Instead the seller gets a reminder after 5 and 15 minutes from ClaimIt's system user, and the people in line are told they keep their place.
- Each item's queue is one metadata key, and an open channel holds 100, so a drop holds up to 90 items.
- When a buyer's connection comes back, the room resyncs metadata, the drop and their claims straight away.
- Buyers watching the seller's Instagram or TikTok Live have this tab in the background, so the queue only skips people who've been gone 10+ minutes. Everyone else is promoted and gets a push-enabled order message.

**Webhook setup** (Console → Chat → Chat settings → Webhooks):

- URL: `https://<your-host>/api/nexconn/webhook`
- Events: `user:connection_status`, `open_channel:pre_messaging` and `direct_channel:pre_messaging` (blocks order cards sent by anyone but a shop)
- Requests are verified with `sha1(AppSecret + Nonce + Timestamp)`.

**Notes on scope:**

- Shops choose a currency. Buyers pay the seller directly: by UPI, by the seller's own payment link (PayPal.me, Venmo and Cash App links get the amount pre-filled; Stripe, Wise and others work as-is), or by account details the seller types once (GCash number, bank account, Zelle email). The buyer taps "I've paid" and adds an optional transaction ID, then the seller confirms in one tap. ClaimIt never holds money.
- Low-priority shedding is a Nexconn server behaviour under load (more than about 40 messages per 200 ms in a room). ClaimIt configures it but doesn't simulate floods.

## Run locally

```bash
npm install
cp .env.example .env      # leave the Nexconn keys empty to use local mock mode
npm run dev               # web on http://localhost:5173, API on :8787
```

With no keys set, the app runs in **mock mode**: a local server-sent-events stand-in with the same surface as the SDK. You can build and test it offline. Open the room with `?as=anyname` to act as several buyers in one browser.

### Connect to Nexconn

1. Create a free account and app at <https://console.nexconn.ai>. Copy the **App Key** and **App Secret** into `.env`.
2. In the Console, enable these services for the app:
   - Open channel **metadata**
   - Open channel **message priority**
   - Priority message types
3. Run the one-time setup, which registers the priority and low-priority message types:
   ```bash
   npm run setup:nexconn
   ```
4. Run `npm run dev` again. `/api/config` should now return `"mode":"nexconn"`.

## Production

```bash
npm run build && npm start   # serves the built web app and the API from one Node process
```

Run it as a single instance with a persistent disk for `DATA_DIR`, because the arbiter relies on one process.

### Deploy to a VM (Google Compute Engine)

`deploy/` holds a small VM deployment. It uses Node 22 under systemd, with Caddy in front for automatic HTTPS. An `sslip.io` hostname means you don't need a domain.

```bash
# first time: installs Node, Caddy, swap and a service user, then deploys
GCP_PROJECT=<project> HOST=<ip-with-dashes>.sslip.io ./deploy/deploy.sh --bootstrap
# every update after that
GCP_PROJECT=<project> HOST=<ip-with-dashes>.sslip.io ./deploy/deploy.sh
```

The script builds locally and uploads the app. It writes the `NEXCONN_*` keys from your local `.env` to `/etc/claimit.env` on the VM, readable only by root, and restarts the service. Data lives in `/var/lib/claimit`.

## Stack

- React, Vite and Tailwind on the web
- Express and SQLite (`node:sqlite`) on Node 22
- Nexconn Chat SDK (`@nexconn/chat`), Nexconn Chat UI (`@nexconn/chatui`) and the Nexconn Platform Chat API
