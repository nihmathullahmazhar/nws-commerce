// Shapes of the jsonb values returned by commands. The generated types can only
// say `Json` for these; the database builds them in _order_summary() and
// dashboard_summary(), and these interfaces mirror those functions.
import type { Enums } from './database.types';

export interface OrderLineSummary {
  line_id: string;
  variant_id: string;
  name: string;
  variant: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  serials: string[] | null;
}

export interface PaymentSummary {
  payment_id: string;
  kind: Enums['payment_kind'];
  method: Enums['payment_method'];
  status: Enums['payment_status'];
  amount: number;
  tendered: number | null;
  change_given: number | null;
  provider: string | null;
  reference: string | null;
  at: string;
}

export interface OrderSummary {
  order_id: string;
  number: string;
  status: Enums['order_status'];
  channel: Enums['sales_channel'];
  location_id: string;
  customer_id: string | null;
  currency_code: string;
  tax_inclusive: boolean;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  shipping_total: number;
  total: number;
  amount_paid: number;
  amount_refunded: number;
  balance_due: number;
  payment_status: Enums['payment_state'];
  reservation_expires_at: string | null;
  placed_at: string;
  fulfilment_method: Enums['fulfilment_method'];
  contact: { full_name?: string; phone?: string; email?: string };
  shipping_address: { line1?: string; line2?: string; city?: string; postcode?: string } | null;
  intended_payment_method: Enums['payment_method'] | null;
  /** Set only when the code actually took money off. */
  coupon_code: string | null;
  promo_discount_total: number;
  promotions: { name: string; amount: number }[];
  lines: OrderLineSummary[];
  payments: PaymentSummary[];
  replayed?: boolean;
  change_due?: number;
  /** Returned by checkout only: opens the order page without an account. */
  access_token?: string;
}

/** quote_order(): an order summary without identity, payments or contact. */
export type OrderQuote = Pick<OrderSummary,
  'currency_code' | 'tax_inclusive' | 'subtotal' | 'discount_total' | 'tax_total' | 'shipping_total' |
  'total' | 'balance_due' | 'fulfilment_method' | 'lines' | 'coupon_code' | 'promo_discount_total' | 'promotions'>;

export interface CartLine {
  variant_id: string; quantity: number; name: string; slug: string; variant: string; sku: string | null;
  unit_price: number; compare_at_price: number | null; unit_of_measure: string; allow_fractional: boolean;
  line_total: number; available: number; for_sale: boolean; image: string | null;
}
export interface Cart { items: CartLine[]; count: number; subtotal: number }

export interface CatalogItem {
  id: string; slug: string; name: string; summary: string | null; brand: string | null;
  min_price: number; max_price: number; compare_at_price: number | null; variant_count: number;
  in_stock: boolean; image: string | null;
}
export interface CatalogResult {
  total: number;
  items: CatalogItem[];
  facets: {
    brands: { slug: string; name: string; count: number }[];
    price: { min: number | null; max: number | null } | null;
    attributes: { id: string; code: string; label: string; unit: string | null; values: { value: string; count: number }[] }[];
  };
}

export interface ProductPage {
  id: string; slug: string; name: string; summary: string | null; description: string | null;
  tracking_mode: Enums['tracking_mode']; unit_of_measure: string; allow_fractional: boolean;
  seo: { title?: string; description?: string };
  brand: { name: string; slug: string } | null;
  breadcrumbs: { name: string; slug: string }[];
  options: { name: string; values: string[] }[];
  variants: { id: string; title: string; sku: string | null; price: number; compare_at_price: number | null; available: number; option_values: string[] | null }[];
  media: { path: string; alt: string | null; variant_id: string | null }[];
  specifications: { label: string; value: unknown; unit: string | null; type: Enums['attribute_type'] }[];
  related: { slug: string; name: string; min_price: number; image: string | null }[];
}

export interface StoreSettings {
  name: string; currency_code: string; prices_include_tax: boolean;
  delivery_enabled: boolean; pickup_enabled: boolean; delivery_fee: number; free_delivery_over: number | null;
  allow_cash_on_delivery: boolean; bank_transfer_details: string | null; online_payments_enabled: boolean;
  contact_phone: string | null; contact_email: string | null;
  returns_enabled: boolean; return_days: number | null; coupons_enabled: boolean;
  web_enabled: boolean; app_enabled: boolean; loyalty_enabled: boolean;
  pickup_locations: { name: string; address: Record<string, string>; phone: string | null }[];
}

export interface DashboardSummary {
  totals: {
    orders: number; gross: number; discounts: number; tax: number;
    sales: number; refunds: number; net: number; outstanding: number;
  };
  by_channel: { channel: Enums['sales_channel']; orders: number; sales: number }[];
  by_method: { method: Enums['payment_method']; amount: number }[];
  awaiting_payment: number;
  stock_conflicts: number;
  low_stock: number;
  catalogue: { products: number; active: number; stocked: number };
  setup: { has_tax_rate: boolean; has_product: boolean; has_stock: boolean; has_staff: boolean; has_sale: boolean };
}

export interface ReceiveResult { receipt_id: string; number: string; lines: number }
export interface OverrideResult {
  approved: boolean;
  approval_id?: string;
  max_discount_percent?: number;
  reason?: 'self_approval' | 'not_authorised' | 'no_pin' | 'locked' | 'wrong_pin';
  attempts_left?: number;
  locked_until?: string;
}

// ---------------------------------------------------------------------------
// POS
// ---------------------------------------------------------------------------
export interface PosQuote extends Omit<OrderQuote, 'fulfilment_method'> {
  discount_percent: number;
  my_discount_limit: number;
  needs_approval: boolean;
  /** Available (on hand minus held) at this till's location, by variant id. */
  stock: Record<string, number>;
}

export interface ShiftSummary {
  shift_id: string; number: string; status: Enums['shift_status'];
  terminal: { id: string; code: string; name: string };
  location: string; cashier: string; opened_at: string; closed_at: string | null;
  opening_float: number;
  sales: { count: number; gross: number; discounts: number; tax: number; total: number };
  by_method: { method: Enums['payment_method']; taken: number; refunded: number; net: number }[];
  cash_movements: { kind: Enums['cash_movement_kind']; amount: number; reason: string; at: string }[];
  expected_cash: number; counted_cash: number | null; variance: number | null; close_note: string | null;
}

export interface PosContext {
  terminals: {
    id: string; code: string; name: string; location_id: string; location: string;
    open_shift: { id: string; number: string; cashier: string; mine: boolean; opened_at: string } | null;
  }[];
  my_open_shift: ShiftSummary | null;
}

export interface PosReceipt extends OrderSummary {
  business: { name: string; phone: string | null; footer: string | null };
  location: { name: string; address: Record<string, string>; phone: string | null };
  terminal: string | null;
  cashier: string | null;
  customer: { name: string | null; phone: string | null; loyalty_points: number } | null;
  /** Gift cards this sale issued, with their full codes (printed once, on this receipt). */
  gift_cards: { code: string; value: number }[];
  points_earned: number | null;
}

// ---------------------------------------------------------------------------
// Returns and warranty
// ---------------------------------------------------------------------------
export interface ReturnSummary {
  return_id: string; number: string; status: Enums['return_status']; channel: Enums['sales_channel'];
  order_id: string; order_number: string; location_id: string | null; customer_id: string | null;
  reason: string | null; refund_total: number; requested_at: string; received_at: string | null;
  exchange_order_id: string | null;
  lines: {
    return_line_id: string; order_line_id: string; name: string; variant: string; quantity: number;
    serial: string | null; line_refund: number; reason: string | null;
    disposition: Enums['return_disposition']; inspected_at: string | null; inspection_note: string | null;
  }[];
  refunds: { method: Enums['payment_method']; amount: number; at: string }[];
  replayed?: boolean;
}

export interface ReturnPreview {
  order_id: string; order_number: string; channel: Enums['sales_channel']; status: Enums['order_status'];
  customer_id: string | null; placed_at: string; within_return_period: boolean; refundable: number;
  refund_total: number;
  lines: { order_line_id: string; name: string; variant: string; quantity: number; line_total: number; returnable: number; serials: string[] | null }[];
}

export interface ExchangeResult {
  return: ReturnSummary; sale: OrderSummary; credit_used: number; leftover_refunded: number;
  leftover_method: Enums['payment_method']; replayed?: boolean;
}

export interface WarrantyHit {
  order_line_id: string; order_id: string; order_number: string; channel: Enums['sales_channel'];
  status: Enums['order_status']; location: string; purchased_at: string;
  customer: { id?: string; name: string | null; phone: string | null } | null;
  product: string; variant: string; quantity: number; serials: string[] | null; matched_serial: string | null;
  warranty_months: number | null; warranty_expires_on: string | null; warranty_status: 'active' | 'expired' | 'none';
  returned_quantity: number;
  claims: { id: string; number: string; status: Enums['warranty_claim_status']; created_at: string }[];
}

export interface WarrantyClaim {
  claim_id: string; number: string; status: Enums['warranty_claim_status']; issue: string; resolution: string | null;
  within_warranty: boolean; expires_on: string | null; created_at: string;
  order_id: string; order_number: string; product: string; variant: string; serial: string | null;
  customer: { id?: string; name: string | null; phone: string | null } | null;
  history: { status: Enums['warranty_claim_status']; note: string | null; at: string; by: string | null }[];
}

// ---------------------------------------------------------------------------
// Reports (0015_analytics.sql)
// ---------------------------------------------------------------------------
export interface ReportTotals {
  orders: number; order_value: number; shipping: number; customers: number; items: number;
  gross: number; discounts: number; promo_discounts: number; manual_discounts: number; tax: number;
  returns: number; returned_items: number; net_sales: number; cogs: number; gross_profit: number;
  margin: number | null; average_sale: number | null; items_per_sale: number | null; gift_cards_sold: number;
}
export type ReportInterval = 'day' | 'week' | 'month';
export interface SalesReport {
  range: { from: string; to: string; previous_from: string; previous_to: string; interval: ReportInterval; timezone: string };
  totals: ReportTotals;
  previous: ReportTotals;
  series: { bucket: string; orders: number; net_sales: number; gross_profit: number }[];
  by_channel: { channel: Enums['sales_channel']; orders: number; net_sales: number }[];
  by_location: { location_id: string; name: string; orders: number; net_sales: number }[];
  by_method: { method: Enums['payment_method']; taken: number; refunded: number; net: number }[];
  /** weekday: 1 = Monday ... 7 = Sunday; hour in the business's time zone. */
  by_hour: { weekday: number; hour: number; orders: number; net_sales: number }[];
}
export type ProductGroup = 'product' | 'variant' | 'category' | 'brand';
export interface ProductReportRow {
  id: string | null; name: string; detail: string | null; quantity: number; orders: number; discounts: number;
  net_sales: number; cogs: number; gross_profit: number; margin: number | null;
  returned: number; return_rate: number | null; share: number | null;
}
export interface ProductReport { group: ProductGroup; net_sales: number; count: number; rows: ProductReportRow[] }
export interface InventoryReportItem {
  variant_id: string; product: string; variant: string; sku: string | null; category: string | null;
  on_hand: number; reserved: number; value: number; retail_value: number; sold: number;
  last_sold_at: string | null; first_in_at: string | null; days_cover: number | null; dead: boolean;
}
export interface InventoryReport {
  days: number;
  totals: { variants: number; units: number; value: number; retail_value: number; dead_variants: number; dead_value: number; out_of_stock: number };
  by_category: { category: string; units: number; value: number; retail_value: number }[];
  items: InventoryReportItem[];
}
export interface CustomerReport {
  totals: {
    orders: number; walk_in_orders: number; walk_in_value: number; customers: number; new_customers: number;
    returning_customers: number; new_value: number; returning_value: number; repeat_customers: number; average_spend: number | null;
  };
  top: { customer_id: string; name: string | null; phone: string | null; orders: number; spent: number; last_order_at: string; is_new: boolean; loyalty_points: number }[];
}
export interface PromotionReport {
  promo_discounts: number; manual_discounts: number; orders_with_promotion: number; orders_with_manual_discount: number;
  promotions: { promotion_id: string; name: string; kind: Enums['promotion_kind']; coupon_code: string | null; orders: number; discount: number; order_value: number; is_active: boolean }[];
}
export interface StaffReport {
  staff: {
    user_id: string | null; name: string; role: Enums['staff_role'] | null; orders: number; order_value: number; net_sales: number;
    items: number; average_sale: number | null; manual_discounts: number; discount_rate: number | null; returns: number; refunded: number;
  }[];
}

// ---------------------------------------------------------------------------
// Customer app (0016_mobile_app.sql)
// ---------------------------------------------------------------------------
export interface MyAccount {
  email: string | null;
  profile: { customer_id: string; full_name: string | null; phone: string | null; email: string | null } | null;
  store_credit: number;
  loyalty: { points: number; point_value: number; points_per_100: number; min_redeem: number; history: { points: number; reason: string; at: string }[] } | null;
  orders: {
    order_id: string; number: string; channel: Enums['sales_channel']; status: Enums['order_status'];
    payment_status: Enums['payment_state']; fulfilment_method: Enums['fulfilment_method']; total: number;
    placed_at: string; access_token: string; items: number; first_item: string | null;
  }[];
}
