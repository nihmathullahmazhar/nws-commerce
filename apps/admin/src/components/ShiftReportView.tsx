import type { ShiftSummary } from '@nws-commerce/db';
import { dateTime, money, titleCase } from '../lib/format';

export function ShiftReportView({ s, currency }: { s: ShiftSummary; currency: string }) {
  const m = (v: number | null | undefined) => money(v ?? 0, currency);
  return (
    <div className="space-y-3 text-sm">
      <div className="text-muted">{s.number} · {s.terminal.name} · {s.cashier}<br />Opened {dateTime(s.opened_at)}{s.closed_at ? ` · closed ${dateTime(s.closed_at)}` : ''}</div>
      <div className="flex justify-between"><span>Sales</span><span className="num">{s.sales.count} · {m(s.sales.total)}</span></div>
      <div className="flex justify-between text-muted"><span>Discounts given</span><span className="num">{m(s.sales.discounts)}</span></div>
      <div className="space-y-1 border-t border-border pt-2">
        {s.by_method.map((b) => <div key={b.method} className="flex justify-between"><span>{titleCase(b.method)}</span><span className="num">{m(b.net)}</span></div>)}
      </div>
      <div className="space-y-1 border-t border-border pt-2">
        <div className="flex justify-between"><span>Opening float</span><span className="num">{m(s.opening_float)}</span></div>
        {s.cash_movements.map((c, i) => <div key={i} className="flex justify-between text-muted"><span>{titleCase(c.kind)}: {c.reason}</span><span className="num">{c.kind === 'paid_in' ? '+' : '-'}{m(c.amount)}</span></div>)}
        <div className="flex justify-between font-semibold"><span>Expected in drawer</span><span className="num">{m(s.expected_cash)}</span></div>
        {s.counted_cash !== null && <>
          <div className="flex justify-between"><span>Counted</span><span className="num">{m(s.counted_cash)}</span></div>
          <div className={`flex justify-between font-semibold ${s.variance ? 'text-danger' : 'text-ok'}`}><span>{(s.variance ?? 0) > 0 ? 'Over' : (s.variance ?? 0) < 0 ? 'Short' : 'Balanced'}</span><span className="num">{m(Math.abs(s.variance ?? 0))}</span></div>
          {s.close_note && <div className="text-muted">Note: {s.close_note}</div>}
        </>}
      </div>
    </div>
  );
}
