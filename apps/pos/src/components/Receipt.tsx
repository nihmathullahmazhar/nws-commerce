import type { PosReceipt } from '@nws-commerce/db';
import { money, qty } from '../lib/format';

const METHOD: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Transfer', qr: 'QR', store_credit: 'Store credit',
  online_gateway: 'Online', cash_on_delivery: 'On delivery', return_credit: 'Exchange credit',
  gift_card: 'Gift card', loyalty_points: 'Points',
};

/** Rendered in a .print-area so window.print() prints only the receipt, 80 mm wide. */
export function Receipt({ r }: { r: PosReceipt }) {
  const c = r.currency_code;
  const addr = r.location.address ?? {};
  return (
    <div className="print-area space-y-2 text-[11px] leading-snug">
      <div className="text-center">
        <div className="text-sm font-bold">{r.business.name}</div>
        <div>{r.location.name}</div>
        {(addr.line1 || addr.city) && <div>{[addr.line1, addr.city].filter(Boolean).join(', ')}</div>}
        {(r.location.phone || r.business.phone) && <div>{r.location.phone ?? r.business.phone}</div>}
      </div>
      <div className="border-t border-dashed border-black pt-1">
        <div className="flex justify-between"><span>{r.number}</span><span>{new Date(r.placed_at).toLocaleString('en-LK', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
        <div>{[r.terminal, r.cashier].filter(Boolean).join(' · ')}</div>
        {r.customer && <div>Customer: {r.customer.name ?? r.customer.phone}</div>}
      </div>
      <div className="border-t border-dashed border-black pt-1">
        {r.lines.map((l) => (
          <div key={l.line_id} className="py-0.5">
            <div>{l.name}{l.variant !== 'Default' ? ` ${l.variant}` : ''}</div>
            <div className="flex justify-between"><span>{qty(l.quantity)} x {money(l.unit_price, c)}</span><span>{money(l.line_subtotal, c)}</span></div>
            {l.discount_amount > 0 && <div className="flex justify-between"><span>  discount</span><span>-{money(l.discount_amount, c)}</span></div>}
            {l.serials && l.serials.length > 0 && <div>  S/N {l.serials.join(', ')}</div>}
          </div>
        ))}
      </div>
      <div className="space-y-0.5 border-t border-dashed border-black pt-1">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(r.subtotal, c)}</span></div>
        {r.promotions.map((p) => <div key={p.name} className="flex justify-between"><span>  {p.name}</span><span>-{money(p.amount, c)}</span></div>)}
        {r.coupon_code && <div>  Coupon {r.coupon_code}</div>}
        {r.discount_total > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(r.discount_total, c)}</span></div>}
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(r.total, c)}</span></div>
        {r.tax_total > 0 && <div className="flex justify-between"><span>{r.tax_inclusive ? 'Tax included' : 'Tax'}</span><span>{money(r.tax_total, c)}</span></div>}
      </div>
      <div className="space-y-0.5 border-t border-dashed border-black pt-1">
        {r.payments.filter((p) => p.kind === 'payment').map((p) => (
          <div key={p.payment_id}>
            <div className="flex justify-between"><span>{METHOD[p.method] ?? p.method}{p.reference && ['gift_card', 'loyalty_points'].includes(p.method) ? ` (${p.reference})` : ''}</span><span>{money(p.tendered ?? p.amount, c)}</span></div>
            {p.change_given ? <div className="flex justify-between"><span>Change</span><span>{money(p.change_given, c)}</span></div> : null}
          </div>
        ))}
      </div>
      {r.gift_cards.length > 0 && (
        <div className="border-t border-dashed border-black pt-1">
          <div className="font-bold">GIFT CARD{r.gift_cards.length > 1 ? 'S' : ''}</div>
          {r.gift_cards.map((g) => <div key={g.code} className="flex justify-between"><span className="font-mono">{g.code}</span><span>{money(g.value, c)}</span></div>)}
          <div>Keep this code safe: it is the card.</div>
        </div>
      )}
      {r.points_earned ? <div className="text-center">Points earned {r.points_earned} · balance {r.customer?.loyalty_points ?? ''}</div> : null}
      {r.business.footer && <div className="border-t border-dashed border-black pt-1 text-center">{r.business.footer}</div>}
      <div className="text-center">Thank you</div>
    </div>
  );
}
