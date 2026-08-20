# OpenZoo Seeker

The desktop [grokui](https://github.com/staccDOTsol/openzoo) client on a [Solana Seeker](https://solanamobile.com/) (or any Android phone with an MWA wallet). Threads, chat, and **your** wallet. You pay per call via Mobile Wallet Adapter. There is no burner key on disk.

This repository is a fork of [FreeSolDev/CordovaSeeker](https://github.com/FreeSolDev/CordovaSeeker) (MIT). It is **not** affiliated with, endorsed by, or related to Solana Mobile, the Solana Seeker, or the Solana Foundation. "Seeker" is referenced only to describe device compatibility.

## What it is

```
┌────────────────────────────────────────────┐
│ www/index.html  (Cordova MWA shell)        │
│  • authorize / signTransaction             │
│  • signAndSendTransaction — wrap only      │
│  ┌──────────────────────────────────────┐  │
│  │ iframe: www/app/  grokui-on-a-phone  │  │
│  │  threads · chat · wallet             │  │
│  │  attach files / folder / text        │  │
│  │  ez-mode wrap → 402 partial-sign     │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

The shell owns the wallet. The UI never sees a key. There is no local `:8402` sidecar and no iframe of `openzoo.fun`.

Attach is abstract: you drop files, a folder, or notes. The app keeps a corpus with that thread behind the scenes. Chat uses the same Claude / `npx openzoo claude` spill path: a context id per thread, older turns bound once, later calls send a short tail plus that id. Completions never pair `x-hrr-context` with the growing messages array. The screen never shows context ids, bind routes, or wrap-twin homework. HUD savings is `directUsd / spentUsd`, not a running sum of `savesVsDirect`.

Race (the spend dial, not spill): pick a band — cheap / medium / expensive / grok4.6 — and launch N models from that band. Default is **best 2 of 4**. The first two *countable* answers are judged by a cheap classifier; empty / HTTP / pay / fetch-failed do not count and cannot win. If nobody clears, the last of those two ships. All-fail is a race-level error, never one model's `fetch failed`. The bubble shows `racing k/n back…` and streams the live racer if tokens are already flowing. Each entrant still pays via x402 + MWA. This is not desktop SPAWN / worktrees.

## Wallet bridge

| direction | type | payload |
|---|---|---|
| shell → app | `wallet-connected` | `{ address, method }` |
| shell → app | `wallet-disconnected` | — |
| app → shell | `wallet-request-info` | late-init wallet info |
| app → shell | `wallet-exit` | close iframe, keep wallet |
| app → shell | `wallet-disconnect` | exit and disconnect |
| app → shell | `wallet-sign-transaction` | `{ id, transaction }` → `wallet-sign-transaction-response` |
| app → shell | `wallet-sign-and-send-transaction` | wrap / top-up only → `wallet-sign-and-send-transaction-response` |
| app → shell | `wallet-copy` | `{ id, text }` → native clipboard + `wallet-copy-response` |
| app → shell | `wallet-paste` | `{ id }` → `wallet-paste-response` `{ text }` |
| shell → app | `app-resume` | after MWA returns — retry pay/build |

**402 pay** calls `MWA.signTransaction` only. Do not use `MWA.signAndSendTransaction` for settlement — the facilitator completes the feePayer slot. **Wrap / top-up may send.**

Tap an address to copy it. Addresses are selectable. A toast says **copied**. Copy goes through Android `ClipboardManager` (`MWA.copyToClipboard`) because `navigator.clipboard` does not work in this Cordova WebView.

This is **your** MWA wallet, not a local burner key. There is no burner on disk.

## Settlement

Rails come from live `GET https://x402.accrue.fund/supported` (Solana rows only on Seeker). The drained mint `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9` is hidden. `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` is the live TOKEN twin (nine wrap accounts, bump 254). Screen copy is USDC / TOKEN / LEOS only.

Ez-mode wrap: read what the MWA wallet actually holds (TOKEN `EVULo…`, USDC, LEOS, or the live twin) and convert via wrap-nav `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE` using the directory `acquire` steps. Same shape as `staccDOTsol/openzoo` `lib/wrap.js`.

Then:

```
402 → wrap if needed (may send) → POST /v1/pay/build → MWA.signTransaction → X-PAYMENT
```

Gateway: `https://x402-tokens.fly.dev`. Payment is the auth. A 402 is persisted while Mobile Wallet Adapter backgrounds the app; `/v1/pay/build` retries after `resume`. Raw WebView `Load failed` / `TypeError` never reach the chat.

```bash
npm test
```

What still needs a real phone is in [DEVICE.md](DEVICE.md).

## Build the APK (Android only)

There is no iOS target. `cordova-plugin-mwa` is Java. Do not switch this tree to Phantom universal links.

```bash
npm install -g cordova
npm install
cordova platform add android
cordova requirements android   # JDK 17+ and Android SDK
cordova run android            # Seeker or Android + Phantom
# or
npm run build                  # debug APK
```

### Release

1. `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.example.json build.json` and fill in passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## Identity

- Widget id: `fun.openzoo.seeker`
- App name: OpenZoo
- MWA identity: name `OpenZoo`, URI `https://openzoo.fun`
- Android icons: `res/icon/android/*.png`

## License

MIT. Forked from FreeSolDev/CordovaSeeker, unaffiliated with Solana Mobile.
