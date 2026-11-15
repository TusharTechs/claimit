# ClaimIt

**Fair live drops for social sellers.** "Comment MINE to buy" turns into a first-come claim queue that every viewer can see. It ends in a paid order.

Thousands of small sellers in India run Instagram and YouTube lives and WhatsApp "drops". Today that means scrolling comments, double claims, fights over who was first, and chasing payment in DMs. ClaimIt replaces that with:

1. **One link.** The seller shares it to their story or group. Buyers join in a tap, with no app and no password.
2. **One Claim button.** The first tap wins. Everyone sees "Held by Priya · 4:12 · 2 in line".
3. **Automatic checkout.** The winner gets a private order chat with the seller's UPI link and a timer. If they don't pay in time, the next person in line is promoted automatically, live, in front of the room.

## How it uses Nexconn

| Feature | Nexconn capability |
|---|---|
| Live drop room for any number of viewers | **Open channel** (server-created per drop, joined from the Web Chat SDK) |
| Live claim queue every viewer sees update at once | **Open channel metadata (KV)**, written by the server arbiter, `onMetadataChanged` on clients |
| Product drops and claim events land even when chat floods | **Priority message types** (`CI:Drop`, `CI:Event`) plus server `priority: 2` sends |
| Fan chatter is shed first under load | **Low-priority message type** (`CI:Chat`) |
| Order card, payment updates, buyer and seller chat | **Direct channel**: custom `CI:Order` / `CI:OrderUpd` messages via the Server API, plus text via the SDK |
| Live viewer count | Open channel participant events |
| Identity | Server-issued **access tokens** (`/v4/auth/access-token/issue`). The App Secret never reaches the browser. |

The **claim arbiter** runs on the app server. Every state change is one synchronous SQLite transaction in a single Node process, so two buyers who tap in the same millisecond can never both win. After each commit, the server publishes the new queue to the open channel's metadata. It also sends a priority event to the room and an order card to the winner's direct channel.

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
- Nexconn Chat SDK (`@nexconn/chat`) and the Nexconn Platform Chat API
