const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const sdk = path.resolve(__dirname, '../packages/sdk')

// The shared KEYKARD SDK lives in the monorepo (memos, key policies, ABIs), resolved from this app's node_modules.
config.watchFolders = [sdk]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
config.resolver.extraNodeModules = { '@keycard/sdk': path.join(sdk, 'src') }

// libhalo (and ethers inside it) import Node's crypto/buffer: point them at the native implementations.
const alias = { crypto: 'react-native-quick-crypto', buffer: '@craftzdog/react-native-buffer', stream: 'readable-stream' }
const appEntry = path.join(__dirname, 'index.ts')
config.resolver.resolveRequest = (ctx, name, platform) => {
  if (name === '@keycard/sdk') return ctx.resolveRequest(ctx, path.join(sdk, 'src/index.ts'), platform)
  // bare imports from the SDK (viem…) resolve from THIS app, so there is exactly one copy of each library
  if (ctx.originModulePath.startsWith(sdk) && !name.startsWith('.') && !path.isAbsolute(name))
    return ctx.resolveRequest({ ...ctx, originModulePath: appEntry }, alias[name] ?? name, platform)
  return ctx.resolveRequest(ctx, alias[name] ?? name, platform)
}
module.exports = config
