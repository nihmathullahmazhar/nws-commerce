import type { Database } from '@nws-commerce/db';

export type VariantHit = Database['public']['Functions']['search_variants']['Returns'][number];
export type Discount = { type: 'percent' | 'amount'; value: number };

export interface TicketLine {
  key: string;
  variantId: string;
  name: string;
  variant: string;
  sku: string | null;
  price: number;
  tracking: 'none' | 'serial' | 'batch' | 'non_stock';
  unit: string;
  fractional: boolean;
  quantity: number;
  serials?: string[];
  discount?: Discount;
}

export interface Customer { id: string; full_name: string | null; phone: string | null; store_credit_balance: number; loyalty_points: number }

export const lineFromHit = (v: VariantHit, quantity = 1, serials?: string[]): TicketLine => ({
  key: crypto.randomUUID(),
  variantId: v.variant_id!, name: v.product_name!, variant: v.variant_title ?? 'Default', sku: v.sku,
  price: Number(v.price ?? 0), tracking: (v.tracking_mode ?? 'none') as TicketLine['tracking'],
  unit: v.unit_of_measure ?? 'each', fractional: !!v.allow_fractional, quantity, serials,
});

/** The ticket as the database's line input (same shape place_order takes). */
export const toLines = (lines: TicketLine[]) => lines.map((l) => ({
  variant_id: l.variantId, quantity: l.quantity,
  ...(l.serials?.length ? { serials: l.serials } : {}),
  ...(l.discount ? { discount: l.discount } : {}),
}));
