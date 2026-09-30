/**
 * KEYKARD design tokens, mirrored from the web (apps/web/app/tokens.css). Keep the two in sync:
 * the website, the web app and this app are one brand.
 */
export const color = {
  bg: '#0A0A0B',
  surface1: '#141416',
  surface2: '#1C1C1F',
  hairline: 'rgba(255,255,255,0.08)',
  hairlineStrong: 'rgba(255,255,255,0.16)',
  text: '#F5F5F7',
  text2: 'rgba(245,245,247,0.62)',
  text3: 'rgba(245,245,247,0.40)',
  accent: '#8B7CFF',
  accentHi: '#B3A9FF',
  accentLo: '#4B3FD1',
  accentInk: '#0A0A0B',
  ok: '#3DDC97',
  warn: '#FFC857',
  bad: '#FF5C5C',
  ice: '#A8DCFF',
} as const

export const radius = { pill: 999, card: 22, panel: 20, input: 14, chip: 14 } as const
export const space = (n: number) => n * 4

export const font = {
  light: 'Geist_300Light',
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const

/** Card skins by line status (same palette as the web card and the 3D card). */
export const skins = {
  active: { tint: 'rgba(139,124,255,0.55)', edge: 'rgba(139,124,255,0.6)', label: 'Active', color: color.accentHi },
  grace: { tint: 'rgba(255,200,87,0.45)', edge: 'rgba(255,200,87,0.6)', label: 'Overdue', color: color.warn },
  frozen: { tint: 'rgba(168,220,255,0.28)', edge: 'rgba(168,220,255,0.5)', label: 'Frozen', color: color.ice },
  defaulted: { tint: 'rgba(255,92,92,0.45)', edge: 'rgba(255,92,92,0.6)', label: 'Defaulted', color: color.bad },
  settled: { tint: 'rgba(255,255,255,0.45)', edge: 'rgba(255,255,255,0.6)', label: 'Settled', color: '#FFFFFF' },
} as const
export type Skin = keyof typeof skins
