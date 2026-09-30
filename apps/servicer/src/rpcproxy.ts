import { net } from './config'

/**
 * JSON-RPC proxy for the web/mobile app. The public Tempo RPC can fail without CORS headers, which browsers
 * surface as a hard error; routing through KEYKARD adds CORS, retries for READS, and an allow-list.
 * Sends are forwarded exactly once (never retried: double-send hazard; the client reconciles by receipt).
 */
const READ = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getLogs', 'net_version',
  'eth_fillTransaction', 'eth_simulateV1',
])
const SEND = new Set(['eth_sendRawTransaction', 'eth_sendRawTransactionSync'])

async function forward(body: unknown, retries: number): Promise<Response> {
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(net.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (r.status >= 500 || r.status === 429) throw new Error(`upstream ${r.status}`)
      return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } })
    } catch (e) {
      last = e
      if (i < retries) await new Promise((res) => setTimeout(res, 300 * 2 ** i))
    }
  }
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: `upstream unavailable: ${String((last as any)?.message ?? last)}` } }, { status: 502 })
}

export async function rpcProxy(req: Request): Promise<Response> {
  const body = (await req.json()) as any
  const calls = Array.isArray(body) ? body : [body]
  let send = false
  for (const c of calls) {
    if (SEND.has(c?.method)) send = true
    else if (!READ.has(c?.method)) return Response.json({ jsonrpc: '2.0', id: c?.id ?? null, error: { code: -32601, message: `method not allowed: ${c?.method}` } })
  }
  return forward(body, send ? 0 : 4)
}
