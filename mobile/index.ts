// Native crypto first: sets global.crypto (getRandomValues, subtle) and Buffer before anything imports viem/ox/libhalo.
import { install } from 'react-native-quick-crypto'
install()
import 'expo-router/entry'
