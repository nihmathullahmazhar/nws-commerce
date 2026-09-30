import {
  createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import clsxBase, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

/** clsx + tailwind-merge: a width or colour passed in wins over the default. */
const clsx = (...values: ClassValue[]) => twMerge(clsxBase(values));

// ---------------------------------------------------------------------------
// Buttons and inputs
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: 'sm' | 'md'; busy?: boolean; icon?: ReactNode;
}>(function Button({ variant = 'secondary', size = 'md', busy, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-hover',
        variant === 'secondary' && 'border border-border-strong bg-surface text-text hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-text',
        variant === 'danger' && 'border border-danger/40 bg-surface text-danger hover:bg-danger-soft',
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

const control = 'w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-faint ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:bg-surface-2 disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={clsx(control, 'h-9', className)} {...rest} />;
  });

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={clsx(control, 'py-2 min-h-20', className)} {...rest} />;
  });

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return <select ref={ref} className={clsx(control, 'h-9 pr-8', className)} {...rest}>{children}</select>;
  });

export function Field({ label, hint, error, children, className }: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-[13px] font-medium text-text">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={clsx('flex items-start gap-2.5', disabled && 'opacity-60')}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={checked} disabled={disabled}
             onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm text-text">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------
export function PageHeader({ title, description, actions, back }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back && <div className="mb-2">{back}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; padded?: boolean;
}) {
  return (
    <section className={clsx('rounded-lg border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={clsx(padded && 'p-4')}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap first-letter:uppercase',
      tone === 'neutral' && 'bg-surface-2 text-muted',
      tone === 'accent' && 'bg-accent-soft text-accent',
      tone === 'ok' && 'bg-ok-soft text-ok',
      tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'danger' && 'bg-danger-soft text-danger',
      tone === 'info' && 'bg-info-soft text-info',
    )}>{children}</span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight text-text">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: {
  icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted">{icon}</div>}
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, align = 'left', className }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return (
    <th className={clsx('border-b border-border bg-surface-2/60 px-3 py-2 text-xs font-medium text-muted whitespace-nowrap',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)}>{children}</th>
  );
}
export function Td({ children, align = 'left', className, colSpan }: {
  children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={clsx('border-b border-border px-3 py-2.5 align-middle',
      align === 'right' ? 'num text-right' : align === 'center' ? 'text-center' : 'text-left', className)}>{children}</td>
  );
}

// ---------------------------------------------------------------------------
// Dialog (native <dialog>, so focus and Escape work for free)
// ---------------------------------------------------------------------------
export function Dialog({ open, onClose, title, description, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode;
  children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // showModal() focuses the first focusable element, which is the close
      // button - so Enter would close the dialog. Put focus where typing goes:
      // a button marked data-autofocus, else the first field in the body.
      requestAnimationFrame(() => {
        const target = el.querySelector<HTMLElement>('[data-autofocus]')
          ?? el.querySelector<HTMLElement>('.dialog-body input:not([type=hidden]):not([disabled]), .dialog-body select, .dialog-body textarea');
        target?.focus();
      });
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={clsx('m-auto w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-text shadow-2xl',
        wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
              <X className="size-4" />
            </button>
          </header>
          <div className="dialog-body overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
            t.value === value ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text')}
        >{t.label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface Toast { id: number; message: string; tone: 'ok' | 'danger' }
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border bg-surface px-3.5 py-2.5 text-sm shadow-lg',
            t.tone === 'ok' ? 'border-ok/30' : 'border-danger/30')}>
            {t.tone === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
