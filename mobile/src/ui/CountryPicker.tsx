import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { COUNTRIES } from '@/lib/countries'
import { Text } from './kit'
import { color, font, radius } from './theme'

export function CountryPicker({ value, onChange, excluded = [] }: { value: string; onChange: (code: string) => void; excluded?: string[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...COUNTRIES].sort((a, b) => a[1].localeCompare(b[1])).filter(([c, n]) => !t || n.toLowerCase().includes(t) || c.toLowerCase() === t)
  }, [q])
  const name = COUNTRIES.find(([c]) => c === value)?.[1]
  return (
    <View style={{ marginTop: 14 }}>
      <Text v="label" style={{ marginBottom: 7 }}>Where do you live?</Text>
      <Pressable testID="country-open" accessibilityRole="button" accessibilityLabel={name ? `Country: ${name}` : 'Select country of residence'} onPress={() => setOpen(true)}
        style={{ minHeight: 54, borderRadius: radius.input, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: color.surface2, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: name ? color.text : color.text3, fontSize: 16 }}>{name ?? 'Select country of residence'}</Text>
        <Text style={{ color: color.text2 }}>▾</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }}>
          <View style={{ padding: 16, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <TextInput testID="country-search" autoFocus placeholder="Search countries" placeholderTextColor={color.text3} value={q} onChangeText={setQ}
              style={{ flex: 1, minHeight: 50, borderRadius: radius.input, backgroundColor: color.surface2, color: color.text, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 16 }} />
            <Text v="h3" style={{ color: color.accentHi }} onPress={() => setOpen(false)}>Close</Text>
          </View>
          <FlatList
            data={list}
            keyExtractor={([c]) => c}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: [c, n] }) => {
              const off = excluded.includes(c)
              return (
                <Pressable testID={`country-${c}`} disabled={off} onPress={() => { onChange(c); setOpen(false); setQ('') }}
                  style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: color.hairline, opacity: off ? 0.4 : pressed ? 0.6 : 1, flexDirection: 'row', justifyContent: 'space-between' })}>
                  <Text style={{ color: color.text, fontSize: 16 }}>{n}</Text>
                  {off ? <Text v="small">Not available yet</Text> : c === value ? <Text style={{ color: color.accentHi }}>✓</Text> : null}
                </Pressable>
              )
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  )
}
