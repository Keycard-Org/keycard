import { useEffect } from 'react'
import { Modal, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated'
import { Button, Text } from './kit'
import { color } from './theme'

/** Full-screen "hold the card to the phone" sheet with a pulsing ring. */
export function TapSheet({ visible, status, onCancel }: { visible: boolean; status: string | null; onCancel: () => void }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = 0
    if (visible) p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1)
  }, [visible, p])
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 0.6 + p.value * 0.8 }], opacity: 1 - p.value }))
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(5,5,8,0.92)', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 2, borderColor: color.accentHi }, ring]} />
          <View style={{ width: 110, height: 70, borderRadius: 12, backgroundColor: color.accentLo, borderWidth: 1, borderColor: color.accentHi }} />
        </View>
        <Text v="h2" style={{ marginTop: 34, textAlign: 'center' }}>{status ?? 'Hold the card to the back of the phone'}</Text>
        <Text v="small" style={{ marginTop: 8, textAlign: 'center' }}>Keep it still until the phone vibrates.</Text>
        <Button title="Cancel" kind="ghost" style={{ marginTop: 34, alignSelf: 'stretch' }} onPress={onCancel} />
      </View>
    </Modal>
  )
}

