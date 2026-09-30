import type { OrderQuote } from '@nws-commerce/db';
import { money } from '@/lib/format';

export function Totals({ quote, currency }: { quote: Pick<OrderQuote, 'subtotal' | 'discount_total' | 'tax_total' | 'shipping_total' | 'total' | 'tax_inclusive' | 'fulfilment_method'> & Partial<Pick<OrderQuote, 'promotions' | 'coupon_code'>>; currency: string }) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between"><dt className="text-ink-2">Subtotal</dt><dd className="num">{money(quote.subtotal, currency)}</dd></div>
      {quote.promotions?.map((p) => (
        <div key={p.name} className="flex justify-between text-ok"><dt>{p.name}</dt><dd className="num">-{money(p.amount, currency)}</dd></div>
      ))}
      {quote.discount_total > 0 && !quote.promotions?.length && <div className="flex justify-between"><dt className="text-ink-2">Discount</dt><dd className="num">-{money(quote.discount_total, currency)}</dd></div>}
      {quote.coupon_code && <p className="text-xs text-ink-3">Coupon {quote.coupon_code} applied</p>}
      <div className="flex justify-between">
        <dt className="text-ink-2">{quote.fulfilment_method === 'pickup' ? 'Collection' : 'Delivery'}</dt>
        <dd className="num">{quote.shipping_total > 0 ? money(quote.shipping_total, currency) : 'Free'}</dd>
      </div>
      {!quote.tax_inclusive && <div className="flex justify-between"><dt className="text-ink-2">Tax</dt><dd className="num">{money(quote.tax_total, currency)}</dd></div>}
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="num">{money(quote.total, currency)}</dd></div>
      {quote.tax_inclusive && quote.tax_total > 0 && <p className="text-xs text-ink-3">Includes {money(quote.tax_total, currency)} tax</p>}
    </dl>
  );
}
