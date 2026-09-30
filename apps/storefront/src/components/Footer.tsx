import type { Store } from '@/lib/store';

export function Footer({ store }: { store: Store }) {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6">
        <div>
          <div className="font-semibold text-ink">{store.name}</div>
          <div className="mt-2 space-y-1 text-ink-2">
            {store.contact_phone && <div>{store.contact_phone}</div>}
            {store.contact_email && <div>{store.contact_email}</div>}
          </div>
        </div>
        {store.pickup_locations.length > 0 && (
          <div>
            <div className="font-semibold text-ink">Visit us</div>
            <ul className="mt-2 space-y-2 text-ink-2">
              {store.pickup_locations.map((l) => (
                <li key={l.name}>{l.name}{[l.address?.line1, l.address?.city].filter(Boolean).length > 0 && <div className="text-ink-3">{[l.address?.line1, l.address?.city].filter(Boolean).join(', ')}</div>}</li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <div className="font-semibold text-ink">Buying from us</div>
          <ul className="mt-2 space-y-1 text-ink-2">
            {store.delivery_enabled && <li>Island-wide delivery{store.free_delivery_over ? `, free over ${store.currency_code} ${store.free_delivery_over.toLocaleString()}` : ''}</li>}
            {store.pickup_enabled && <li>Collect in store</li>}
            {store.allow_cash_on_delivery && <li>Pay on delivery</li>}
            {store.bank_transfer_details && <li>Bank transfer</li>}
          </ul>
        </div>
      </div>
    </footer>
  );
}
