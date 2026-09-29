import { serve } from '@hono/node-server'
import { env, net } from './config'
import { migrate } from './migrate'
import { app } from './api'
import { relayHandler } from './relay'
import { rpcProxy } from './rpcproxy'
import { cors } from 'hono/cors'
import { startScheduler } from './scheduler'
import { startWatcher } from './watcher'
import { treasury } from './chain'

await migrate()

app.use('/rpc', cors({ origin: env.WEB_ORIGINS.split(',').map((s) => s.trim()) }))
app.post('/rpc', (c) => rpcProxy(c.req.raw))

// Fee-sponsorship relay (viem `withRelay` compatible) mounted next to the API.
app.all('/relay', async (c) => {
  const res = (await relayHandler.fetch(c.req.raw)) as Response
  if (c.req.method === 'POST') {
    const body = await res.clone().text()
    if (body.includes('"error"')) console.error('[relay] rejected:', body.slice(0, 500))
  }
  return res
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`KEYCARD servicer on :${info.port}  network=${net.name} chain=${net.chainId}`)
  console.log(`  registry=${net.registry} lineBook=${net.lineBook} treasury=${treasury.address}`)
})

if (process.env.DISABLE_JOBS !== '1') {
  startWatcher()
  startScheduler()
}
