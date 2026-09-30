import type { Enums } from '@nws-commerce/db';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

export const ORDER_STATUS: Record<Enums['order_status'], { label: string; tone: Tone }> = {
  pending_payment: { label: 'Awaiting payment', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  completed: { label: 'Completed', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  stock_conflict: { label: 'Stock conflict', tone: 'danger' },
};

export const PAYMENT_STATE: Record<Enums['payment_state'], { label: string; tone: Tone }> = {
  unpaid: { label: 'Unpaid', tone: 'warn' },
  partially_paid: { label: 'Part paid', tone: 'warn' },
  paid: { label: 'Paid', tone: 'ok' },
  partially_refunded: { label: 'Part refunded', tone: 'info' },
  refunded: { label: 'Refunded', tone: 'neutral' },
};

export const CHANNEL: Record<Enums['sales_channel'], string> = {
  online: 'Online', pos: 'Counter', mobile_app: 'App', phone_order: 'Phone', admin_order: 'Admin',
};

export const METHOD: Record<Enums['payment_method'], string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', qr: 'QR', online_gateway: 'Online gateway',
  store_credit: 'Store credit', cash_on_delivery: 'Cash on delivery', return_credit: 'Exchange credit',
  gift_card: 'Gift card', loyalty_points: 'Loyalty points',
};

export const RETURN_STATUS: Record<Enums['return_status'], { label: string; tone: Tone }> = {
  requested: { label: 'Requested', tone: 'warn' },
  received: { label: 'Received', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const DISPOSITION: Record<Enums['return_disposition'], { label: string; tone: Tone }> = {
  pending_inspection: { label: 'Awaiting inspection', tone: 'warn' },
  restock: { label: 'Back in stock', tone: 'ok' },
  damaged: { label: 'Damaged', tone: 'danger' },
  service: { label: 'At service', tone: 'info' },
  write_off: { label: 'Written off', tone: 'neutral' },
};

export const CLAIM_STATUS: Record<Enums['warranty_claim_status'], { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'warn' }, received: { label: 'Received', tone: 'info' }, in_repair: { label: 'In repair', tone: 'info' },
  awaiting_parts: { label: 'Awaiting parts', tone: 'info' }, ready: { label: 'Ready to collect', tone: 'accent' },
  replaced: { label: 'Replaced', tone: 'ok' }, refunded: { label: 'Refunded', tone: 'ok' }, rejected: { label: 'Rejected', tone: 'danger' },
  closed: { label: 'Closed', tone: 'neutral' },
};
