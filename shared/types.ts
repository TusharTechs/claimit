// Shared between server and web. Message type names are what Nexconn sees on the wire.

export const MSG = {
  /** Product card dropped into the live room. Registered as a Nexconn PRIORITY message type. */
  DROP: 'CI:Drop',
  /** Claim / waitlist / sold events in the live room. PRIORITY. */
  EVENT: 'CI:Event',
  /** Fan chatter in the live room. Registered as LOW-PRIORITY so it is shed first under load. */
  CHAT: 'CI:Chat',
  /** Order card sent seller -> buyer in a 1:1 Direct channel. */
  ORDER: 'CI:Order',
  /** Order status update in the 1:1 Direct channel. */
  ORDER_UPDATE: 'CI:OrderUpd',
  TEXT: 'RC:TxtMsg',
} as const;

export const CUSTOM_TYPES = [MSG.DROP, MSG.EVENT, MSG.CHAT, MSG.ORDER, MSG.ORDER_UPDATE];

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
}

export interface MyClaim {
  id: string;
  itemId: string;
  itemName: string;
  price: number;
  image: string | null;
  status: ClaimStatus;
  position: number; // 0 = holder, 1.. = waitlist position
  holdUntil: number | null;
  upi: string;
  shop: string;
}

export interface AppConfig {
  mode: 'nexconn' | 'mock';
  appKey: string | null;
  area: string;
}

export const itemKey = (itemId: string) => `i_${itemId}`;
