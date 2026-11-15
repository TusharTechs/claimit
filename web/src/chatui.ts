// Seller inbox powered by Nexconn Chat UI (@nexconn/chatui). Desktop only: Chat UI does not support portrait mobile.
// It must be initialised after NCEngine.initialize() and before NCEngine.connect(), so rt runs it as a before-connect hook.
import type { NCChatUIApplication } from '@nexconn/chatui';
import { MSG, type OrderContent, type OrderUpdateContent } from '../../shared/types';
import { api } from './api';

let app: NCChatUIApplication | null = null;
let root: HTMLElement | null = null;

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function contentOf<T>(m: any): T {
  let c = m?.content ?? m?.message?.content;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { /* keep */ } }
  return (c || {}) as T;
}

/** Order card bubble, rendered by Chat UI as <nc-c-claimit-order>. */
class OrderBubble extends HTMLElement {
  private _m: unknown;
  set message(m: unknown) { this._m = m; this.render(); }
  get message() { return this._m; }
  connectedCallback() { this.render(); }
  private render() {
    if (!this._m) return;
    const o = contentOf<OrderContent>(this._m);
    const img = o.image ? `<img src="${esc(o.image)}" alt="" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0">` : '';
    this.innerHTML = `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:220px;max-width:280px;padding:12px;border-radius:16px;background:#dbf5e9;border:2px solid rgba(20,160,106,.35);color:#17120e">
        <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#14a06a">ClaimIt order</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px">${img}
          <div style="min-width:0">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.itemName)}</div>
            <div style="font-size:13px;color:#3a312a">${rupees(o.price)} · UPI ${esc(o.upi)}</div>
          </div>
        </div>
      </div>`;
  }
}

/** Order status line bubble, <nc-c-claimit-order-update>. */
class OrderUpdateBubble extends HTMLElement {
  private _m: unknown;
  set message(m: unknown) { this._m = m; this.render(); }
  get message() { return this._m; }
  connectedCallback() { this.render(); }
  private render() {
    if (!this._m) return;
    const u = contentOf<OrderUpdateContent>(this._m);
    const tone = u.status === 'paid' ? '#14a06a' : u.status === 'paying' ? '#8a5a00' : '#3a312a';
    this.innerHTML = `<div style="font-family:Inter,system-ui,sans-serif;max-width:280px;padding:8px 12px;border-radius:12px;background:#f5efe8;font-size:13px;color:${tone}">${esc(u.text)}</div>`;
  }
}

/** Called by rt between NCEngine.initialize() and NCEngine.connect(). */
export async function setupChatUI(selfId: string, selfName: string) {
  if (app) return app;
  const { NCChatUIApplication } = await import('@nexconn/chatui');
  const created = NCChatUIApplication.initialize({
    language: 'en_US',
    hooks: {
      async reqUserProfiles(userIds) {
        const known = userIds.filter((id) => id !== selfId);
        const rows = known.length ? await api.sellerProfiles(known).catch(() => []) : [];
        return userIds.map((id) => (id === selfId ? { userId: id, name: selfName } : rows.find((r) => r.userId === id) ?? { userId: id, name: 'Buyer' }));
      },
      async reqGroupProfiles(groupIds) { return groupIds.map((groupId) => ({ groupId, name: 'Group', memberCount: 0 })); },
      async reqGroupMembers() { return []; },
      async reqSystemProfiles(systemIds) { return systemIds.map((targetId) => ({ targetId, name: 'ClaimIt' })) as any; },
      getDefaultUserProfile: (userId) => ({ userId, name: userId === selfId ? selfName : 'Buyer' }),
    },
  });
  if (!created) throw new Error('Nexconn Chat UI failed to initialise');
  created.registerCustomMessages([
    {
      messageType: MSG.ORDER, isPersisted: true, isCounted: true,
      digest: (m) => `[Order] ${contentOf<OrderContent>(m).itemName ?? ''}`,
      component: { tagName: 'claimit-order', elementClass: OrderBubble },
    },
    {
      messageType: MSG.ORDER_UPDATE, isPersisted: true, isCounted: true,
      digest: (m) => contentOf<OrderUpdateContent>(m).text ?? '[Order update]',
      component: { tagName: 'claimit-order-update', elementClass: OrderUpdateBubble },
    },
  ]);
  created.ready();
  app = created;
  return app;
}

export function chatUIReady() { return !!app; }

/** Attach the Chat UI root element into `container` (kept alive between opens). */
export function mountChatUI(container: HTMLElement) {
  if (!app) return false;
  if (!root) {
    root = document.createElement('nc-chat-ui-app-provider');
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.display = 'block';
  }
  if (root.parentElement !== container) container.appendChild(root);
  return true;
}

export async function openDirect(userId: string) {
  if (!app) return;
  const { DirectChannelIdentifier } = await import('@nexconn/chat');
  await app.openChannel(new DirectChannelIdentifier(userId), true);
}
