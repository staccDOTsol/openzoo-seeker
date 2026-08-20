# Device-only work

Threads, attach, the rail picker, and wrap account layout can be reasoned about on a laptop. These parts cannot.

## Needs a real Seeker, or Android + Phantom

Mobile Wallet Adapter talks to a **native wallet app** over `solana-wallet://`. That path does not exist in a desktop browser, Chrome DevTools, or an emulator without a wallet APK.

On a real device:

| step | why it is device-only |
|---|---|
| `MWA.authorize` | Opens the wallet chooser; returns the user's pubkey + auth token |
| `MWA.signTransaction` | Partial-signs `/v1/pay/build` bytes. Never broadcasts. |
| `MWA.signAndSendTransaction` | Wrap / top-up only. The wrap program may submit. |
| End-to-end 402 settlement | Wallet must cover USDC, TOKEN, LEOS, or the live twin. Facilitator simulation runs against mainnet |

## What you can check without a phone

```bash
npm test
```

That covers: live `/supported` rails, hide the drained mint, label the live TOKEN twin without saying the old name, nine-account wrap + bump 254, ez-mode pick from what the wallet holds, no bind / twin homework in the UI, address copy/paste, 402 persist + pay/build retry after a WebView `Load failed`, and CSP `connect-src` for the gateway, accrue, and Solana RPCs.

Do not expect a guest mode. Chat is paid from the connected wallet.
