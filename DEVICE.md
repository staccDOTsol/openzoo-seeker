# Device-only work

The bundled chat UI and the rail picker can be reasoned about on a laptop. These parts cannot.

## Needs a real Seeker, or Android + Phantom

Mobile Wallet Adapter talks to a **native wallet app** over `solana-wallet://`. That path does not exist in:

- a desktop browser
- Chrome DevTools
- the Android emulator unless a wallet APK is installed and MWA intents resolve

On a real device you still have to do:

| step | why it is device-only |
|---|---|
| `MWA.authorize` | Opens the wallet chooser; returns the user's pubkey + auth token |
| `MWA.signTransaction` | Partial-signs the `/v1/pay/build` bytes. The iframe never sees a key |
| End-to-end 402 settlement | Wallet must cover the Solana mint behind the USDC / TOKEN / LEOS button. Facilitator simulation runs against mainnet |

The payment path calls **`signTransaction` only**. `signAndSendTransaction` would submit the tx and break x402 (feePayer slot must stay empty for the gateway/facilitator).

## What you can check without a phone

```bash
npm run test:rails
```

That covers: map the USDC / TOKEN / LEOS button onto a Solana accept row, never default to the first Solana row, never pick eip155, steer “Fund this wallet with USDC / TOKEN” when `/v1/pay/build` does not wrap.

Gateway reachability (CORS, 402 shape, free bind) can be probed with `curl` against `https://x402-tokens.fly.dev`. Public Solana RPCs used for balance reads (`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`) are often rate-limited from cloud IPs; a phone on residential/mobile networks is the intended client.

## Do not expect an emulator guest mode

There is no "play as guest." Chat is paid from the connected wallet. If MWA is missing, the shell says so and does not open a fake session.
