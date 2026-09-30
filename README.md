# KEYCARD

**Credit your family can back.** An uncollateralised stablecoin credit line on [Tempo](https://tempo.xyz). Every rule is enforced by the protocol itself.

- **Your card is a key.** Your passkey (Face ID or fingerprint), a password-locked device key, or a physical NFC chip card is authorised as an *access key* on a KEYCARD-funded credit account. Tempo's AccountKeychain enforces three things on it:
  - a per-period spend limit;
  - an allow-list containing only the KEYCARD network address;
  - an expiry.
  Paying anyone else is refused on-chain (`CallNotAllowed`).
- **Repayment is an auto-debit you control.** You grant KEYCARD one key on your own wallet. It can take at most the agreed amount per period, and only to KEYCARD. You sign it once. Revoke it and your card freezes within seconds.
- **Family can back you.** A relative signs one capped key on *their* wallet. It is pulled only if you miss a payment after the grace period, and never more than they agreed. Affordability is checked: at most 20% of disposable income.
- **Real, unique people.** Identity comes from [Self](https://self.xyz): a zero-knowledge passport proof. KEYCARD never sees the passport.
- **A merchant network.** Anyone verified can become a merchant, get a code, a QR and a pay link, and accept tap-to-pay. The network settles merchants in USDC today. With a card-network partner, the same authorisation settles merchants in **fiat at any POS**; only the settlement leg changes.

## Repository

```
contracts/        Foundry: KeycardRegistry (identity + merchant mirror), LineBook (public credit file). No custody.
packages/sdk/     Shared TS: networks, key policies (spend / mandate / guarantee), memos, ABIs.
apps/servicer/    Node API + fee relay (tempo.ts Handler.feePayer) + RPC proxy + scheduler + revocation watcher + settlement.
apps/web/         Next.js app: onboarding, passkey/password wallet, card, pay, deposit, guarantor, merchant, physical NFC card.
deployments/      Deployed contract addresses per network.
```

## Deployed (Tempo testnet, Moderato 42431). Verified on the explorer
- KeycardRegistry `0x6c5ccc3f51641004bb6d21a0b49f2f4c9132837a`
- LineBook `0x346f5f3755e7ddbad1f4efd408468159a57207d0`

## Run locally

```bash
pnpm install
docker run -d --name keycard-db -e POSTGRES_PASSWORD=keycard -e POSTGRES_USER=keycard -e POSTGRES_DB=keycard \
  -p 127.0.0.1:5544:5432 postgres:16-alpine
cp .env.example .env.testnet   # then generate keys:
pnpm --filter @keycard/sdk exec tsx scripts/keygen.ts testnet   # writes .env.testnet if absent
TEMPO_NETWORK=testnet pnpm --filter @keycard/servicer start      # :8787 (runs migrations)
pnpm --filter @keycard/web build && pnpm --filter @keycard/web start   # :3000; proxies /api /rpc /relay to :8787
```

Passkeys need HTTPS on phones. For a phone test, run `cloudflared tunnel --url http://localhost:3000` and add the tunnel URL to `WEB_ORIGINS`.

## Deploy (Railway)
Set these in each Railway service's Settings (Railway config-as-code is deprecated for new services).
1. New project → **Deploy from GitHub repo** → `Keycard-Org/keycard`. Add **Postgres** (+ New → Database → PostgreSQL).
2. **Service `keycard-servicer`:** start command `cd apps/servicer && ./node_modules/.bin/tsx src/main.ts`, health check `/api/health`, Serverless OFF. Variables:
   - the operator keys, `KEY_ENC_SECRET` and `ADMIN_TOKEN` (see `.env.example`);
   - `TEMPO_NETWORK=testnet`;
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}`;
   - `WEB_ORIGINS` and `PUBLIC_WEB_ORIGIN` (the web URL).
   Generate a public domain. It must stay running, because the scheduler and watcher live in this process.
3. **Service `keycard-web`** (same repo, second service): build command `pnpm --filter @keycard/web build`, start command `cd apps/web && ./node_modules/.bin/next start -p $PORT`. Variable `SERVICER_URL=https://<keycard-servicer domain>`. Generate a public domain.
4. The Self webhook is `https://<keycard-servicer domain>/api/self/webhook`.

`render.yaml` is kept as an alternative Render Blueprint.

## Tests
```bash
cd contracts && forge test                                               # 29 contract tests
cd apps/servicer
TEMPO_NETWORK=testnet npx tsx test/e2e.ts            # 23 checks: signup → mandate → card → merchant → auto-debit → upgrade → guarantor → freeze
TEMPO_NETWORK=testnet npx tsx test/e2e-default.ts    # missed payment → grace → guarantor pays exactly the shortfall → frozen
TEMPO_NETWORK=testnet npx tsx test/e2e-card.ts       # physical NFC card: link, tap-pay, tap limit, freeze
TEMPO_NETWORK=testnet npx tsx test/e2e-edge.ts       # grace blocks phone+card, pay now, revoke/re-enable auto-debit, default → settle → new line
USE_DEV_VERIFY=1 TEMPO_NETWORK=testnet npx tsx test/browser.ts   # real Chromium + virtual WebAuthn authenticator
```
The e2e tests run against a live servicer on Tempo testnet: real transactions, fees sponsored.

## Safety notes
- **Fees are always sponsored.** Fees paid by a limited key's own account count against its limit, so KEYCARD sponsors every fee and pulls stay exact.
- **Every money movement has a unique memo** and is reconciled on-chain before any retry. Writes are never transport-retried.
- **Server-held keys are AES-256-GCM encrypted at rest:** credit-account roots, mandate keys and guarantee keys.
- **Password wallets are encrypted client-side** (PBKDF2 600k + AES-GCM). The server stores only the ciphertext and a scrypt hash of a separately derived login proof.
- **Physical cards use HaLo key slot 1 only.** The Burner wallet's own key (slots 8/9) and PIN are never touched.

## Credits

- Merchant helix on the landing page: geometry, spiral layout and depth-fade shader ported from
  [YildizDikme/3D-threejs-spiral-gallery](https://github.com/YildizDikme/3D-threejs-spiral-gallery), used with the author's permission.
- Landing page built with [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [drei](https://github.com/pmndrs/drei),
  [GSAP](https://gsap.com) (ScrollTrigger, SplitText), [Lenis](https://github.com/darkroomengineering/lenis) and [NumberFlow](https://number-flow.barvian.me).
