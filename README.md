# alpenglow-dashboard

A minimal TanStack Start dashboard for Solana network health and Alpenglow
readiness. RPC access runs on the Node server through `@solana/web3.js` v3.
Live slot, epoch, transaction, and performance metrics update every two seconds;
the heavier validator and protocol snapshot updates every 30 seconds.

```bash
bun install
bun run dev
```

Edit `src/routes/index.tsx` to get started. Add route files under
`src/routes`; TanStack Router updates `src/routeTree.gen.ts` for you.

By default the dashboard reads from Solana's public mainnet RPC. Set a custom
server-side endpoint when needed:

```bash
SOLANA_RPC_URL=https://your-rpc.example bun run dev
```

The feature activation table uses the public devnet and testnet endpoints by
default. Private endpoints can be configured with `SOLANA_DEVNET_RPC_URL` and
`SOLANA_TESTNET_RPC_URL`.

Build the Node server bundle with:

```bash
bun run build
node .output/server/index.mjs
```
