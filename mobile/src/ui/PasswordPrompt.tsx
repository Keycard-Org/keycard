import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native'
import { setPasswordPrompter } from '@/lib/wallet'
import { Button, Field, Text } from './kit'
import { color, radius } from './theme'

/** The app-wide masked password sheet used to unlock the password wallet before signing. */
export function PasswordPromptHost() {
  const [req, setReq] = useState<{ message: string; resolve: (v: string | null) => void } | null>(null)
  const [pw, setPw] = useState('')
  const input = useRef<TextInput>(null)
  useEffect(() => {
    setPasswordPrompter((message) => new Promise((resolve) => {
      setPw('')
      setReq({ message, resolve })
    }))
    return () => {
      setPasswordPrompter(null)
    }
  }, [])
  const done = (v: string | null) => {
    req?.resolve(v)
    setReq(null)
    setPw('')
  }
  return (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={() => done(null)} onShow={() => setTimeout(() => input.current?.focus(), 50)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => done(null)} accessibilityLabel="Cancel" />
        <View style={{ backgroundColor: color.surface1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 22, paddingBottom: 30, borderWidth: 1, borderColor: color.hairline }}>
          <Text v="h2">{req?.message ?? ''}</Text>
          <Text v="small" style={{ marginTop: 4 }}>Your password unlocks the wallet on this phone. It never leaves the device.</Text>
          <Field
            ref={input}
            testID="password-prompt-input"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            placeholder="Password"
            value={pw}
            onChangeText={setPw}
            onSubmitEditing={() => pw && done(pw)}
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Button title="Cancel" kind="ghost" style={{ flex: 1 }} onPress={() => done(null)} />
            <Button testID="password-prompt-unlock" title="Unlock" style={{ flex: 1 }} disabled={!pw} onPress={() => done(pw)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
