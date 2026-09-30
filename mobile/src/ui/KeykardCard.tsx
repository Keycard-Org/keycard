import { useEffect } from 'react'
import { AccessibilityInfo, StyleSheet, Text as RNText, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { DeviceMotion } from 'expo-sensors'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, interpolate, Easing } from 'react-native-reanimated'
import Svg, { Circle, Path } from 'react-native-svg'
import { color, font, skins, type Skin } from './theme'

/** The key logomark (same geometry as the web wordmark). */
export function KeyMark({ size = 22, stroke = color.accent }: { size?: number; stroke?: string }) {
  return (
    <Svg width={size} height={(size * 16) / 30} viewBox="0 0 30 16" fill="none">
      <Circle cx={7} cy={8} r={5.5} stroke={stroke} strokeWidth={2.2} />
      <Path d="M12.5 8H28M24 8v5" stroke={stroke} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  )
}

function Contactless() {
  return (
    <Svg width={22} height={24} viewBox="0 0 22 24" fill="none">
      {[5, 9, 13, 17].map((r, i) => (
        <Path key={i} d={`M${3 + i * 4} ${12 - r * 0.55} A ${r} ${r} 0 0 1 ${3 + i * 4} ${12 + r * 0.55}`} stroke="rgba(245,245,247,0.85)" strokeWidth={1.8} strokeLinecap="round" />
      ))}
    </Svg>
  )
}

type Props = {
  amount: string
  label?: string
  sub?: string
  skin?: Skin
  last4?: string
  badge?: string
  tilt?: boolean
  width?: number
  testID?: string
}

/**
 * The KEYKARD. Tilts with the phone (DeviceMotion), with a holographic sheen that slides across as it moves.
 * Skins follow the line status (active · overdue · frozen · defaulted · settled). Respects reduce-motion.
 */
export function KeykardCard({ amount, label = 'Available to spend', sub, skin = 'active', last4, badge, tilt = true, width, testID }: Props) {
  const rx = useSharedValue(0)
  const ry = useSharedValue(0)
  const enter = useSharedValue(0)
  const k = skins[skin]

  useEffect(() => {
    enter.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.exp) })
    let sub: { remove: () => void } | null = null
    let alive = true
    ;(async () => {
      if (!tilt || process.env.EXPO_PUBLIC_NO_TILT === '1' || (await AccessibilityInfo.isReduceMotionEnabled())) return
      if (!(await DeviceMotion.isAvailableAsync().catch(() => false)) || !alive) return
      DeviceMotion.setUpdateInterval(33)
      sub = DeviceMotion.addListener((m) => {
        const r = m.rotation
        if (!r) return
        // beta: front/back tilt (~0.9 rad holding a phone), gamma: left/right
        rx.value = withSpring(Math.max(-1, Math.min(1, (r.beta - 0.9) / 0.5)), { damping: 18, stiffness: 120 })
        ry.value = withSpring(Math.max(-1, Math.min(1, r.gamma / 0.5)), { damping: 18, stiffness: 120 })
      })
    })()
    return () => {
      alive = false
      sub?.remove()
    }
  }, [tilt, rx, ry, enter])

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { perspective: 900 },
      { translateY: interpolate(enter.value, [0, 1], [30, 0]) },
      { rotateX: `${-rx.value * 9}deg` },
      { rotateY: `${ry.value * 11}deg` },
    ],
  }))
  const sheen = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(ry.value, [-1, 1], [-160, 160]) }, { translateY: interpolate(rx.value, [-1, 1], [-40, 40]) }, { rotate: '18deg' }],
  }))

  const frozen = skin === 'frozen'
  return (
    <Animated.View testID={testID} style={[{ width: width ?? '100%', aspectRatio: 1.586 }, cardStyle]} accessible accessibilityLabel={`KEYKARD, ${k.label}. ${label} ${amount}. ${sub ?? ''}`}>
      <View style={[st.card, { borderColor: k.edge, shadowColor: k.tint }]}>
        <LinearGradient colors={frozen ? ['#1d2230', '#12141b', '#0b0c10'] : ['#1b1538', '#0e0c1c', '#07070c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={[k.tint, 'rgba(0,0,0,0)']} start={{ x: 0.1, y: 0 }} end={{ x: 0.7, y: 0.8 }} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { opacity: 0.06 }]}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={{ position: 'absolute', left: -40, right: -40, top: `${22 + i * 5}%`, height: 1, backgroundColor: color.accentHi, transform: [{ rotate: '-8deg' }] }} />
          ))}
        </View>
        <Animated.View pointerEvents="none" style={[st.sheen, sheen]}>
          <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.13)', 'rgba(179,169,255,0.16)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>

        <View style={st.top}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <KeyMark size={24} stroke="#F5F5F7" />
            <RNText style={st.mark}>KEYKARD</RNText>
          </View>
          {badge ? (
            <View style={[st.badge, { borderColor: k.color }]}>
              <RNText style={[st.badgeText, { color: k.color }]}>{badge.toUpperCase()}</RNText>
            </View>
          ) : (
            <Contactless />
          )}
        </View>
        <LinearGradient colors={['#E8E4FF', '#9D92E8', '#D9D4FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.chip} />

        <View style={st.bottom}>
          <View style={{ flex: 1 }}>
            <RNText style={st.label}>{label.toUpperCase()}</RNText>
            <RNText testID={testID ? `${testID}-amount` : undefined} style={st.amount} adjustsFontSizeToFit numberOfLines={1}>{amount}</RNText>
            {sub ? <RNText style={st.sub}>{sub}</RNText> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            {last4 ? <RNText style={st.num}>•••• {last4}</RNText> : null}
            <RNText style={st.net}>CREDIT · TEMPO</RNText>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}

const st = StyleSheet.create({
  card: { flex: 1, borderRadius: 22, overflow: 'hidden', borderWidth: 1, padding: 20, justifyContent: 'space-between', elevation: 16, shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 18 } },
  sheen: { position: 'absolute', top: -60, bottom: -60, left: '30%', width: 120 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mark: { fontFamily: font.bold, fontSize: 14, letterSpacing: 3, color: '#F5F5F7' },
  badge: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.25)' },
  badgeText: { fontFamily: font.monoMedium, fontSize: 10, letterSpacing: 1.4 },
  chip: { position: 'absolute', left: 20, top: 64, width: 44, height: 34, borderRadius: 7, opacity: 0.92 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  label: { fontFamily: font.medium, fontSize: 10, letterSpacing: 1.8, color: 'rgba(255,255,255,0.6)' },
  amount: { fontFamily: font.light, fontSize: 44, lineHeight: 50, letterSpacing: -2.2, color: '#fff', fontVariant: ['tabular-nums'] },
  sub: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  num: { fontFamily: font.mono, fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  net: { fontFamily: font.bold, fontSize: 10, letterSpacing: 2, color: color.accentHi },
})
