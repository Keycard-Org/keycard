/** @type {import('next').NextConfig} */
const SERVICER_URL = process.env.SERVICER_URL ?? 'http://localhost:8787'

const nextConfig = {
  transpilePackages: ['@keycard/sdk'],
  reactStrictMode: true,
  // Same-origin API: the app (web, PWA, tunnel, phone) talks only to its own origin; Next forwards to the servicer.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${SERVICER_URL}/api/:path*` },
      { source: '/rpc', destination: `${SERVICER_URL}/rpc` },
      { source: '/relay', destination: `${SERVICER_URL}/relay` },
    ]
  },
}
export default nextConfig
