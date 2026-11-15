# ClaimIt

**Fair live drops for social sellers.** "Comment MINE to buy" turns into a first-come claim queue that every viewer can see. It ends in a paid order.

Thousands of small sellers in India run Instagram and YouTube lives and WhatsApp "drops". Today that means scrolling comments, double claims, fights over who was first, and chasing payment in DMs. ClaimIt replaces that with:

1. **One link.** The seller shares it to their story or group. Buyers join in a tap, with no app and no password.
2. **One Claim button.** The first tap wins. Everyone sees "Held by Priya · 4:12 · 2 in line".
3. **Automatic checkout.** The winner gets a private order chat with the seller's UPI link and a timer. If they don't pay in time, the next person in line is promoted automatically, live, in front of the room.

## How it uses Nexconn

| Feature | Nexconn capability |
|---|---|
| Live drop room for any number of viewers | **Open channel**, created server-side for each drop and joined through the Web Chat SDK |
| Live claim queue that every viewer sees update at the same moment | **Open channel metadata (KV)**, written by the server arbiter with per-item versions; clients use `onMetadataChanged` |
| Drops and claim events always get through, fan chat is dropped first under load | **Priority message types** (`CI:Drop`, `CI:Event`) plus a **low-priority type** (`CI:Chat`), registered by `npm run setup:nexconn`; server sends use `priority: 2` |
| Anti-scam room chat: phone numbers and UPI IDs masked, sender names forced to their real value | **Pre-message webhook** (`open_channel:pre_messaging`): Nexconn holds each message until our server passes or rewrites it |
| Presence-aware queue: offline buyers are skipped, and a holder who leaves loses the hold early | **User connection-status webhook** (`user:connection_status`) |
| Order card whose status updates in place (waiting for payment, then paid, then confirmed) | **Direct channel** custom message `CI:Order`, sent with `hasMetadata`; the server updates it through **message metadata** (`/v4/channel-type/message/metadata/set`), and clients use `onMessageMetadataUpdated` |
| Buyer and seller order chat | Direct channel: text through the SDK, plus `CI:OrderUpd` status messages |
| Seller inbox on desktop | **Nexconn Chat UI** (`@nexconn/chatui`), with custom Web Component bubbles that render live order cards |
| Followers notified when a shop opens a new drop | Direct channel batch send (up to 1,000 recipients per call) |
| Live viewer count | `/v4/open-channel/get` (server, cached for 5s) plus participant events |
| Identity | Server-issued **access tokens**. The App Secret never reaches the browser. |

The **claim arbiter** runs on the app server. Every state change is a single synchronous SQLite transaction in one Node process, so two buyers who tap in the same millisecond can never both win. After each commit, the server publishes the new queue to the open channel's metadata, sends a priority event to the room, and sends or updates the winner's order card.

**Webhook setup** (Console → Chat → Chat settings → Webhooks):

- URL: `https://<your-host>/api/nexconn/webhook`
- Events: `user:connection_status` and `open_channel:pre_messaging`
- Requests are verified with `sha1(AppSecret + Nonce + Timestamp)`.

**Notes on scope:**

- Payment is a direct UPI transfer to the seller. The buyer taps "I've paid" and adds an optional transaction ID, then the seller confirms in one tap. ClaimIt never holds money.
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
