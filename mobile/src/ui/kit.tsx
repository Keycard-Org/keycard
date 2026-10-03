import { forwardRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { SafeAreaView } from 'react-native-safe-area-context'
import { color, font, radius, space } from './theme'
import { EyeIcon } from './Icons'

/* ---------------- text ---------------- */
type Variant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'label' | 'eyebrow' | 'mono' | 'amount'
const variants: Record<Variant, TextStyle> = {
  display: { fontFamily: font.medium, fontSize: 44, lineHeight: 44, letterSpacing: -2.2, color: color.text },
  h1: { fontFamily: font.medium, fontSize: 32, lineHeight: 34, letterSpacing: -1.4, color: color.text },
  h2: { fontFamily: font.medium, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: color.text },
  h3: { fontFamily: font.medium, fontSize: 16, lineHeight: 22, letterSpacing: -0.2, color: color.text },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.text2 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.text2 },
  label: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: color.text2 },
  eyebrow: { fontFamily: font.monoMedium, fontSize: 11, lineHeight: 14, letterSpacing: 1.8, color: color.accentHi, textTransform: 'uppercase' },
  mono: { fontFamily: font.mono, fontSize: 12.5, lineHeight: 18, color: color.text2 },
  amount: { fontFamily: font.light, fontSize: 46, lineHeight: 50, letterSpacing: -2.4, color: color.text, fontVariant: ['tabular-nums'] },
}
export function Text({ v = 'body', style, ...p }: TextProps & { v?: Variant }) {
  return <RNText {...p} style={[variants[v], style]} />
}

/* ---------------- layout ---------------- */
export function Screen({ children, scroll = true, style, padded = true, edges = ['top', 'bottom'] }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; padded?: boolean; edges?: ('top' | 'bottom')[] }) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={[padded && s.pad, style]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && s.pad, style]}>{children}</View>
  )
  return <SafeAreaView edges={edges} style={s.screen}>{body}</SafeAreaView>
}
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.panel, style]}>{children}</View>
}
export const Gap = ({ h = 12 }: { h?: number }) => <View style={{ height: h }} />
export function Row({ children, style, between }: { children: ReactNode; style?: StyleProp<ViewStyle>; between?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, between && { justifyContent: 'space-between' }, style]}>{children}</View>
}

/* ---------------- buttons ---------------- */
type BtnKind = 'primary' | 'ghost' | 'danger' | 'quiet'
export function Button({ title, onPress, kind = 'primary', disabled, busy, style, small, icon, testID }: {
  title: string; onPress?: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; small?: boolean; icon?: ReactNode; testID?: string
}) {
  const off = disabled || busy
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      accessibilityLabel={title}
      disabled={off}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        onPress?.()
      }}
      style={({ pressed }) => [
        s.btn, small && s.btnSmall, btnKinds[kind],
        pressed && !off && { transform: [{ scale: 0.98 }], opacity: 0.92 },
        off && { opacity: 0.4 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' ? color.accentInk : color.text} /> : icon}
      <RNText numberOfLines={1} style={[s.btnText, small && { fontSize: 13.5 }, { color: kind === 'primary' ? color.accentInk : kind === 'danger' ? color.bad : color.text }]}>
        {title}
      </RNText>
    </Pressable>
  )
}
const btnKinds: Record<BtnKind, ViewStyle> = {
  primary: { backgroundColor: color.accent },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.hairlineStrong },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,92,92,0.45)' },
  quiet: { backgroundColor: color.surface2 },
}

export function Link({ title, onPress, style, testID }: { title: string; onPress: () => void; style?: StyleProp<TextStyle>; testID?: string }) {
  return (
    <RNText testID={testID} accessibilityRole="link" onPress={onPress} suppressHighlighting style={[{ fontFamily: font.medium, fontSize: 14, color: color.accentHi }, style]}>
      {title}
    </RNText>
  )
}

/* ---------------- inputs ---------------- */
export const Field = forwardRef<TextInput, TextInputProps & { label?: string; hint?: string; big?: boolean; error?: string | null }>(function Field(
  { label, hint, big, error, style, secureTextEntry, ...p }, ref,
) {
  // password fields get a show/hide toggle
  const [shown, setShown] = useState(false)
  const secret = !!secureTextEntry
  return (
    <View style={{ marginTop: 14 }}>
      {label && <Text v="label" style={{ marginBottom: 7 }}>{label}</Text>}
      <View>
        <TextInput
          ref={ref}
          placeholderTextColor={color.text3}
          selectionColor={color.accent}
          cursorColor={color.accent}
          {...p}
          secureTextEntry={secret && !shown}
          style={[s.input, big && s.inputBig, secret && { paddingRight: 52 }, !!error && { borderColor: 'rgba(255,92,92,0.6)' }, style]}
        />
        {secret && (
          <Pressable
            testID={p.testID ? `${p.testID}-toggle` : undefined}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            hitSlop={10}
            onPress={() => setShown((v) => !v)}
            style={{ position: 'absolute', right: 6, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <EyeIcon off={shown} />
          </Pressable>
        )}
      </View>
      {error ? <Text v="small" style={{ color: color.bad, marginTop: 6 }}>{error}</Text> : hint ? <Text v="small" style={{ marginTop: 6, color: color.text3 }}>{hint}</Text> : null}
    </View>
  )
})

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[s.segBtn, on && { backgroundColor: color.text }]}>
            <RNText style={{ fontFamily: font.medium, fontSize: 14, color: on ? color.bg : color.text2 }}>{o.label}</RNText>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Check({ checked, onChange, children, testID }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', gap: 12, marginTop: 16, alignItems: 'flex-start' }}>
      <View style={[s.box, checked && { backgroundColor: color.accent, borderColor: color.accent }]}>
        {checked && <RNText style={{ color: color.accentInk, fontFamily: font.bold, fontSize: 13, lineHeight: 15 }}>✓</RNText>}
      </View>
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <Text v="small" style={{ color: color.text }}>{children}</Text> : children}</View>
    </Pressable>
  )
}

/* ---------------- messages ---------------- */
export function Banner({ kind = 'info', children, style }: { kind?: 'info' | 'error' | 'warn' | 'ok'; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = { info: color.accent, error: color.bad, warn: color.warn, ok: color.ok }[kind]
  return (
    <View accessibilityRole={kind === 'error' ? 'alert' : undefined} style={[s.banner, { borderColor: c + '55', backgroundColor: c + '14' }, style]}>
      {typeof children === 'string' ? <Text v="small" style={{ color: kind === 'error' ? '#FFB3B3' : color.text }}>{children}</Text> : children}
    </View>
  )
}

export function Chip({ label, value, style }: { label: string; value: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.chip, style]}>
      <Text v="small" style={{ fontSize: 12 }}>{label}</Text>
      {typeof value === 'string' ? <RNText style={{ fontFamily: font.medium, fontSize: 17, color: color.text, marginTop: 2, fontVariant: ['tabular-nums'] }}>{value}</RNText> : value}
    </View>
  )
}

export function Stepper({ steps, at }: { steps: string[]; at: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginVertical: 14 }} accessibilityLabel={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}>
      {steps.map((st, i) => (
        <View key={st} style={{ flex: 1, gap: 8 }}>
          <View style={{ height: 3, borderRadius: 3, backgroundColor: i < at ? color.accentLo : i === at ? color.accent : 'rgba(255,255,255,0.1)' }} />
          <RNText style={{ fontFamily: font.regular, fontSize: 11.5, color: i === at ? color.text : i < at ? color.text2 : color.text3 }}>{st}</RNText>
        </View>
      ))}
    </View>
  )
}

export function ListRow({ icon, title, sub, right, rightSub, onPress, positive }: { icon: string; title: string; sub?: string; right?: string; rightSub?: string; onPress?: () => void; positive?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.listRow, pressed && { opacity: 0.7 }]}>
      <View style={s.listIcon}><RNText style={{ color: positive ? color.ok : color.accentHi, fontSize: 16 }}>{icon}</RNText></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={{ fontFamily: font.medium, fontSize: 14.5, color: color.text }}>{title}</RNText>
        {sub ? <RNText numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12, color: color.text3, marginTop: 1 }}>{sub}</RNText> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {right ? <RNText style={{ fontFamily: font.medium, fontSize: 14.5, color: positive ? color.ok : color.text, fontVariant: ['tabular-nums'] }}>{right}</RNText> : null}
        {rightSub ? <RNText style={{ fontFamily: font.regular, fontSize: 11.5, color: color.text3, marginTop: 1 }}>{rightSub}</RNText> : null}
      </View>
    </Pressable>
  )
}

export const Divider = () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color.hairline, marginVertical: 4 }} />

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pad: { paddingHorizontal: space(5), paddingBottom: space(10), paddingTop: space(2) },
  panel: { backgroundColor: color.surface1, borderRadius: radius.panel, borderWidth: 1, borderColor: color.hairline, padding: 18, marginTop: 14 },
  btn: { minHeight: 54, borderRadius: radius.pill, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnSmall: { minHeight: 40, paddingHorizontal: 16 },
  btnText: { fontFamily: font.semibold, fontSize: 15.5, letterSpacing: -0.2 },
  input: { minHeight: 54, borderRadius: radius.input, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: color.surface2, paddingHorizontal: 16, color: color.text, fontFamily: font.regular, fontSize: 16 },
  inputBig: { minHeight: 72, fontFamily: font.light, fontSize: 36, letterSpacing: -1 },
  seg: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radius.pill, backgroundColor: color.surface2, borderWidth: 1, borderColor: color.hairline, marginTop: 14 },
  segBtn: { flex: 1, minHeight: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12 },
  chip: { flex: 1, padding: 12, borderRadius: radius.chip, backgroundColor: color.surface1, borderWidth: 1, borderColor: color.hairline },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  listIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: color.surface2, alignItems: 'center', justifyContent: 'center' },
})
