# OpenZoo Seeker

Pay-per-call [openzoo](https://openzoo.fun) chat on a [Solana Seeker](https://solanamobile.com/) (or any Android phone with an MWA wallet). You pay from **your own wallet** via Mobile Wallet Adapter. There is no burner key on disk.

This repository is a fork of [FreeSolDev/CordovaSeeker](https://github.com/FreeSolDev/CordovaSeeker) (MIT). It is **not** affiliated with, endorsed by, or related to Solana Mobile, the Solana Seeker, or the Solana Foundation. "Seeker" is referenced only to describe device compatibility.

## What it is

```
┌────────────────────────────────────────────┐
│ www/index.html  (wallet shell)             │
│  • MWA authorize / signTransaction         │
│  ┌──────────────────────────────────────┐  │
│  │ iframe: www/app/index.html           │  │
│  │  chat + bind + stats                 │  │
│  │  402 → pick a payable Solana rail    │  │
│  │  → /v1/pay/build → postMessage sign  │  │
│  │  → retry with X-PAYMENT              │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

The shell owns the wallet. The chat iframe never sees a key.

This phone build is **chat, bind, and stats only**. It does not implement RUN / WRITE / READ / SERVE — those need a desktop filesystem.

Do **not** iframe `https://openzoo.fun` (landing page) or `https://chat.openzoo.fun` (Open WebUI + Wallet Standard / injected Phantom — in an iframe it shows “No Solana wallet detected” and does not speak `wallet-sign-transaction`). The bundled UI is trimmed from `www/app/gui.desktop.html`. Do not port grokui-app (Electron + `:8402`).

Gateway (live, CORS-enabled): `https://x402-tokens.fly.dev`

| call | purpose |
|---|---|
| `GET /v1/models` | model list |
| `GET /v1/stats` | public zoo stats |
| `POST /v1/chat/completions` | chat (402 → pay) |
| `POST /v1/hrr/bind` | bind a corpus (free as of 2026-08-17; payment loop still wired) |
| `POST /v1/pay/build` | unsigned Solana payment tx (no auth) |

Any `Authorization` string is accepted. **Payment is the auth.**

## Wallet bridge

| direction | type | payload |
|---|---|---|
| shell → app | `wallet-connected` | `{ address, method }` |
| shell → app | `wallet-disconnected` | — |
| app → shell | `wallet-request-info` | late-init wallet info |
| app → shell | `wallet-exit` | close iframe, keep wallet |
| app → shell | `wallet-disconnect` | exit and disconnect |
| app → shell | `wallet-sign-message` | `{ id, message }` → `wallet-sign-response` |
| app → shell | `wallet-sign-transaction` | `{ id, transaction }` → `wallet-sign-transaction-response` |

`wallet-sign-transaction` calls **`MWA.signTransaction` only**. Do not use `MWA.signAndSendTransaction` for x402 — settlement needs a partial-signed tx (payer slot signed, feePayer slot empty) that the gateway/facilitator completes. Submitting it from the wallet breaks that flow.

## Settlement rails

A 402 lists several `accepts` rows (typically Solana + eip155). Seeker filters to `network.startsWith('solana:')` and maps the user's **USDC / TOKEN / LEOS** button onto the matching `extra.symbol` / `asset`. It never silently takes `accepts[0]`. Screen copy never says the settlement twin names.

On-screen / funding mints (what the user holds):

| button | underlying |
|---|---|
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| TOKEN | `EVULoNF4DeMBN4dGiZiDfpiiTfNZgoCvXWWgaV3epump` |
| LEOS | `5xgsnby6P9zqGK71J7H4yJLxzqPvNbC7rDZxNzjHmj7e` (only if a Solana accept row exists) |

`/v1/pay/build` was decoded live on 2026-08-20 as **transfer-only** (ComputeBudget + Token-2022 TransferChecked). It does not assemble wrap+transfer, despite `chat.openzoo.fun` `loader.js` claiming that. If the wallet cannot cover the quoted settlement mint, the app steers **“Fund this wallet with USDC / TOKEN”** and will not wrap on device.

Rail-picker unit tests (no device required):

```bash
npm run test:rails
```

What still requires a real phone is listed in [DEVICE.md](DEVICE.md).

## Build the APK (Android only)

There is no iOS target. `cordova-plugin-mwa` is Java.

```bash
npm install -g cordova
npm install
cordova platform add android
cordova requirements android   # JDK 17+ and Android SDK
cordova run android            # Seeker or Android + Phantom
# or
npm run build                  # debug APK
```

Requirements: Android SDK + JDK 17 or newer. If `cordova requirements android` fails, the APK was not produced — do not expect a checked-in binary.

### Release

1. `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.example.json build.json` and fill in passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## Identity

- Widget id: `fun.openzoo.seeker`
- App name: OpenZoo
- MWA identity: name `OpenZoo`, URI `https://openzoo.fun`
- Android icons: `res/icon/android/*.png` (from `res/icon/src/token.jpg`)

## License

MIT. Forked from FreeSolDev/CordovaSeeker, unaffiliated with Solana Mobile.
