/**
 * Signs every Android build (debug and release) with the KEYKARD key, when its env vars are present.
 * One signing key = one "android:apk-key-hash" origin, which is what the website's assetlinks.json vouches for,
 * so passkeys work in development builds exactly as in the shipped APK.
 * The keystore and its passwords are never in the repo: KEYKARD_UPLOAD_{STORE_FILE,KEY_ALIAS,STORE_PASSWORD,KEY_PASSWORD}.
 */
const { withAppBuildGradle } = require('expo/config-plugins')

const BLOCK = `
    signingConfigs {
        keykard {
            def f = System.getenv('KEYKARD_UPLOAD_STORE_FILE')
            if (f) {
                storeFile file(f)
                storePassword System.getenv('KEYKARD_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('KEYKARD_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('KEYKARD_UPLOAD_KEY_PASSWORD')
            }
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents
    if (g.includes('signingConfigs {\n        keykard')) return c
    g = g.replace(/signingConfigs \{/, BLOCK)
    // both build types use the KEYKARD key when it is configured, else fall back to the debug key
    g = g.replace(
      /buildTypes \{([\s\S]*?)debug \{\s*signingConfig signingConfigs\.debug/,
      "buildTypes {$1debug {\n            signingConfig System.getenv('KEYKARD_UPLOAD_STORE_FILE') ? signingConfigs.keykard : signingConfigs.debug",
    )
    g = g.replace(
      /release \{([\s\S]*?)signingConfig signingConfigs\.debug/,
      "release {$1signingConfig System.getenv('KEYKARD_UPLOAD_STORE_FILE') ? signingConfigs.keykard : signingConfigs.debug",
    )
    c.modResults.contents = g
    return c
  })
}
