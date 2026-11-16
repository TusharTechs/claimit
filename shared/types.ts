// Shared between server and web. Message type names are what Nexconn sees on the wire.

export const MSG = {
  /** Product card dropped into the live room. Registered as a Nexconn PRIORITY message type. */
  DROP: 'CI:Drop',
  /** Claim / waitlist / sold events in the live room. PRIORITY. */
  EVENT: 'CI:Event',
  /** Fan chatter in the live room. Registered as LOW-PRIORITY so it is shed first under load. */
  CHAT: 'CI:Chat',
  /** The shop answering the room. A PRIORITY type (sent by our server as the shop), so it's never shed with fan chat. */
  SELLER_CHAT: 'CI:SellerChat',
  /** Order card sent seller -> buyer in a 1:1 Direct channel. */
  ORDER: 'CI:Order',
  /** Order status update in the 1:1 Direct channel. */
  ORDER_UPDATE: 'CI:OrderUpd',
  TEXT: 'RC:TxtMsg',
} as const;

export const CUSTOM_TYPES = [MSG.DROP, MSG.EVENT, MSG.CHAT, MSG.SELLER_CHAT, MSG.ORDER, MSG.ORDER_UPDATE];

export type ItemStatus = 'draft' | 'live' | 'held' | 'paying' | 'sold' | 'closed';
export type ClaimStatus = 'holding' | 'waiting' | 'paying' | 'paid' | 'expired' | 'cancelled' | 'rejected';

export interface Person { id: string; name: string }

/** Value stored in the open channel's metadata under key `i_<itemId>`. Kept small: every viewer receives it. */
export interface ItemState {
  id: string;
  status: ItemStatus;
  holder?: Person | null;
  holdUntil?: number | null;
  waitlist: Person[];
  claims: number;
  v: number; // monotonically increasing version so clients can ignore stale updates
}

/** Value stored under key `drop`. */
export interface DropState {
  status: 'live' | 'ended';
  current: string | null;
  /** When the next item drops automatically (demo room), so viewers see a countdown instead of dead air. */
  nextAt?: number | null;
}

export interface Item {
  id: string;
  dropId: string;
  name: string;
  price: number;
  image: string | null;
  status: ItemStatus;
  idx: number;
  droppedAt: number | null;
}

export interface DropCardContent {
  itemId: string;
  name: string;
  price: number;
  image: string | null;
  idx: number;
}

export type EventKind = 'live' | 'claimed' | 'waitlisted' | 'promoted' | 'released' | 'paying' | 'sold' | 'ended';

export interface EventContent {
  kind: EventKind;
  itemId?: string;
  itemName?: string;
  actor?: string;
  text: string;
}

export interface ChatContent { text: string; name: string }

export interface OrderContent {
  claimId: string;
  dropId: string;
  itemId: string;
  itemName: string;
  price: number;
  image: string | null;
  upi: string;
  shop: string;
  holdUntil: number;
  currency?: string;
  payLink?: string | null;
  payNote?: string | null;
}

export interface OrderUpdateContent {
  claimId: string;
  status: ClaimStatus;
  text: string;
}

export interface PublicDrop {
  id: string;
  title: string;
  shop: string;
  sellerId: string;
  channelId: string;
  status: 'live' | 'ended';
  liveUrl: string | null;
  holdSeconds: number;
  items: Item[];
  state: Record<string, ItemState>;
  drop: DropState;
  /** People currently in the live room (from Nexconn), if known. */
  inRoom?: number | null;
  /** The always-on demo room (other buyers are bots). */
  demo?: boolean;
  currency?: string;
  /** Track record buyers can check before paying a seller directly. */
  trust?: SellerTrust;
}

export interface SellerTrust { orders: number; since: number; avgConfirmSec: number | null;
  /** Share of "I've paid" claims the shop rejected, and how many buyers reported the shop: shown so buyers can judge risk. */
  rejectedPct: number; reports: number }

export interface MyClaim {
  id: string;
  itemId: string;
  itemName: string;
  price: number;
  image: string | null;
  status: ClaimStatus;
  position: number; // 0 = holder, 1.. = waitlist position
  holdUntil: number | null;
  /** When the claim was made: an item can be re-dropped, and an old round's claim must not count for the new one. */
  created?: number;
  upi: string;
  shop: string;
  currency?: string;
  payLink?: string | null;
  payNote?: string | null;
  demo?: boolean;
  shippedAt?: number | null;
  tracking?: string | null;
}

export interface AppConfig {
  mode: 'nexconn' | 'mock';
  appKey: string | null;
  area: string;
}

export const itemKey = (itemId: string) => `i_${itemId}`;

/** Currencies sellers can choose. India (UPI) is the launch market; everywhere else uses a payment link. */
export const CURRENCIES = ['INR', 'USD', 'PHP', 'IDR', 'SGD', 'MYR', 'THB', 'AED', 'GBP', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Live status chip for the order card (driven by Nexconn message metadata key `s`). */
export const ORDER_STATUS: Record<string, { label: string; tone: 'sun' | 'mint' | 'muted' | 'hot' }> = {
  holding: { label: '⏳ Waiting for payment', tone: 'sun' },
  paying: { label: '💸 Buyer paid · confirming', tone: 'sun' },
  paid: { label: '✅ Payment confirmed', tone: 'mint' },
  shipped: { label: '📦 Shipped', tone: 'mint' },
  expired: { label: '⌛ Hold expired', tone: 'muted' },
  cancelled: { label: 'Released', tone: 'muted' },
  rejected: { label: '❌ Payment not confirmed', tone: 'hot' },
};
