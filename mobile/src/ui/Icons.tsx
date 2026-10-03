import Svg, { Path } from 'react-native-svg'
import { color } from './theme'

export const CheckIcon = ({ size = 44, stroke = color.ok }: { size?: number; stroke?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
)

export const EyeIcon = ({ off = false, size = 22, stroke = 'rgba(245,245,247,0.62)' }: { off?: boolean; size?: number; stroke?: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
    <Path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke={stroke} strokeWidth={1.8} />
    {off && <Path d="M4 4l16 16" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" />}
  </Svg>
)
