import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Image, Pressable, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { OrderQuote } from '@nws-commerce/db';
import { radius, useTheme, type Theme } from '@/lib/theme';
import { initials, money } from '@/lib/format';
import { mediaUrl } from '@/lib/supabase';

type Tone = 'ink' | 'ink2' | 'ink3' | 'brand' | 'sale' | 'ok' | 'danger' | 'warn' | 'brandFg';

export function Text({ children, size = 15, weight = '400', tone = 'ink', style, numberOfLines, center }: {
  children: ReactNode; size?: number; weight?: TextStyle['fontWeight']; tone?: Tone; style?: StyleProp<TextStyle>;
  numberOfLines?: number; center?: boolean;
}) {
  const t = useTheme();
  return (
    <RNText numberOfLines={numberOfLines}
      style={[{ color: t[tone], fontSize: size, fontWeight: weight, lineHeight: Math.round(size * 1.35) }, center && { textAlign: 'center' }, style]}>
      {children}
    </RNText>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, busy, icon, style, accessibilityLabel }: {
  title: string; onPress?: PressableProps['onPress']; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean; busy?: boolean; icon?: keyof typeof Feather.glyphMap; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.brand : variant === 'secondary' ? t.surface : 'transparent';
  const fg = variant === 'primary' ? t.brandFg : variant === 'danger' ? t.danger : t.ink;
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={(e) => { if (variant === 'primary') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress?.(e); }}
      style={({ pressed }) => [{
        minHeight: 50, borderRadius: radius.md, paddingHorizontal: 18, backgroundColor: bg,
        borderWidth: variant === 'secondary' ? 1 : 0, borderColor: t.line,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: off ? 0.45 : pressed ? 0.8 : 1,
      }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Feather name={icon} size={18} color={fg} /> : null}
      <RNText style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</RNText>
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label: string; hint?: string; error?: string | null }>(
  function Field({ label, hint, error, style, ...props }, ref) {
    const t = useTheme();
    return (
      <View style={{ gap: 6 }}>
        <Text size={13} weight="500" tone="ink2">{label}</Text>
        <TextInput ref={ref} placeholderTextColor={t.ink3} accessibilityLabel={label}
          style={[{
            minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: error ? t.danger : t.line, backgroundColor: t.surface,
            paddingHorizontal: 14, fontSize: 16, color: t.ink,
          }, style]} {...props} />
        {error ? <Text size={12} tone="danger">{error}</Text> : hint ? <Text size={12} tone="ink3">{hint}</Text> : null}
      </View>
    );
  });

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: t.line, padding: padded ? 16 : 0 }, style]}>{children}</View>;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  const t = useTheme();
  const map = { neutral: [t.tile, t.ink2], ok: [t.okSoft, t.ok], warn: [t.warnSoft, t.warn], danger: [t.dangerSoft, t.danger] } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
      <RNText style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</RNText>
    </View>
  );
}

export function Loader({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
      <ActivityIndicator color={t.ink2} />
      {label && <Text tone="ink3" size={14}>{label}</Text>}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: {
  icon: keyof typeof Feather.glyphMap; title: string; body?: string; action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.tile, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon} size={24} color={t.ink2} />
      </View>
      <Text size={17} weight="600" center>{title}</Text>
      {body && <Text tone="ink2" center>{body}</Text>}
      {action && <View style={{ marginTop: 8, alignSelf: 'stretch' }}>{action}</View>}
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: t.dangerSoft, borderRadius: radius.md, padding: 12, gap: 8 }}>
      <Text tone="danger" size={14}>{message}</Text>
      {onRetry && <Pressable onPress={onRetry} accessibilityRole="button"><Text tone="danger" size={14} weight="600">Try again</Text></Pressable>}
    </View>
  );
}

/** The product photo, or a quiet tile with its initials - never a stock photo. */
export function ProductImage({ path, name, size, style }: { path: string | null | undefined; name: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const url = mediaUrl(path);
  const box: StyleProp<ViewStyle> = [{ backgroundColor: t.tile, borderRadius: radius.md, overflow: 'hidden', aspectRatio: 1 }, size ? { width: size, height: size } : { width: '100%' }, style];
  if (url) return <View style={box}><Image source={{ uri: url }} accessibilityLabel={name} style={{ width: '100%', height: '100%' }} resizeMode="cover" /></View>;
  return (
    <View style={[box, { alignItems: 'center', justifyContent: 'center' }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text tone="ink3" weight="600" size={size && size < 80 ? 15 : 26}>{initials(name)}</Text>
    </View>
  );
}

export function Price({ price, compareAt, currency, size = 15 }: { price: number; compareAt?: number | null; currency: string; size?: number }) {
  const onSale = compareAt !== null && compareAt !== undefined && compareAt > price;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <Text size={size} weight="600" tone={onSale ? 'sale' : 'ink'}>{money(price, currency)}</Text>
      {onSale && <Text size={size - 2} tone="ink3" style={{ textDecorationLine: 'line-through' }}>{money(compareAt, currency)}</Text>}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const t = useTheme();
  const btn = (icon: 'minus' | 'plus', next: number, disabled: boolean, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={() => onChange(next)} hitSlop={6}
      style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
      <Feather name={icon} size={18} color={t.ink} />
    </Pressable>
  );
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: radius.md, alignSelf: 'flex-start' }}>
      {btn('minus', value - 1, value - 1 < min, `One fewer ${label}`)}
      <Text weight="600" style={{ minWidth: 28, textAlign: 'center' }}>{String(value)}</Text>
      {btn('plus', value + 1, max !== undefined && value + 1 > max, `One more ${label}`)}
    </View>
  );
}

export function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: Tone }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text tone={tone ?? (strong ? 'ink' : 'ink2')} weight={strong ? '600' : '400'} size={strong ? 17 : 15} style={{ flexShrink: 1 }}>{label}</Text>
      <Text tone={tone ?? 'ink'} weight={strong ? '700' : '400'} size={strong ? 17 : 15}>{value}</Text>
    </View>
  );
}

export function Totals({ quote, currency }: {
  quote: Pick<OrderQuote, 'subtotal' | 'discount_total' | 'tax_total' | 'shipping_total' | 'total' | 'tax_inclusive' | 'fulfilment_method'> & Partial<Pick<OrderQuote, 'promotions' | 'coupon_code'>>;
  currency: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Row label="Subtotal" value={money(quote.subtotal, currency)} />
      {quote.promotions?.map((p) => <Row key={p.name} label={p.name} value={`-${money(p.amount, currency)}`} tone="ok" />)}
      {quote.discount_total > 0 && !quote.promotions?.length && <Row label="Discount" value={`-${money(quote.discount_total, currency)}`} />}
      <Row label={quote.fulfilment_method === 'pickup' ? 'Collection' : 'Delivery'} value={quote.shipping_total > 0 ? money(quote.shipping_total, currency) : 'Free'} />
      {!quote.tax_inclusive && <Row label="Tax" value={money(quote.tax_total, currency)} />}
      <Divider />
      <Row label="Total" value={money(quote.total, currency)} strong />
      {quote.tax_inclusive && quote.tax_total > 0 && <Text size={12} tone="ink3">Includes {money(quote.tax_total, currency)} tax</Text>}
      {quote.coupon_code && <Text size={12} tone="ink3">Coupon {quote.coupon_code} applied</Text>}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.line }, style]} />;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text size={18} weight="700">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} onPress={onPress}
      style={{ paddingHorizontal: 14, height: 36, borderRadius: 18, justifyContent: 'center', borderWidth: 1,
               borderColor: active ? t.ink : t.line, backgroundColor: active ? t.ink : t.surface }}>
      <RNText style={{ color: active ? t.bg : t.ink, fontSize: 14, fontWeight: '500' }}>{label}</RNText>
    </Pressable>
  );
}

export type { Theme };
