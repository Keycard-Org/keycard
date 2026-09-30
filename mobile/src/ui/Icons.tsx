import Svg, { Path } from 'react-native-svg'
import { color } from './theme'

export const CheckIcon = ({ size = 44, stroke = color.ok }: { size?: number; stroke?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)
