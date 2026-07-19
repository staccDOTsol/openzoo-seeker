# CordovaSeeker — open-source Seeker game template

Build games for the [Solana Seeker](https://solanamobile.com/) phone with **plain web tech** —
no Unity, no React Native, no official Solana Mobile SDK wrappers. Just:

- **Apache Cordova** — wraps your HTML/JS game in a native Android APK
- **`cordova-plugin-mwa`** (included, ~300 lines of Java) — a minimal native
  [Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview) client:
  `authorize`, `signMessage`, `signTransaction`, `signAndSendTransaction`
- A **wallet shell** (`www/index.html`) that handles connecting, then runs your game in an
  iframe and talks to it over `postMessage`
- A demo **clicker game** (`www/game/`) that works fully offline

## How it works

```
┌─────────────────────────────────┐
│ www/index.html  (wallet shell)  │
│  • MWA native connect (Seeker)  │
│  • Phantom/Solflare deep links  │
│  • local burner wallet          │
│  ┌───────────────────────────┐  │
│  │ iframe: www/game/         │  │
│  │  your game — receives     │  │
│  │  wallet events via        │  │
│  │  postMessage              │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

The shell owns all wallet state; the game never touches keys. Messages:

| direction | type | payload |
|---|---|---|
| shell → game | `wallet-connected` | `{ address, method }` |
| shell → game | `wallet-disconnected` | — |
| game → shell | `wallet-request-info` | ask for wallet info (late init) |
| game → shell | `wallet-disconnect` | exit back to the shell |
| game → shell | `wallet-sign-message` | `{ id, message }` → `wallet-sign-response` |

To ship a hosted game instead of a bundled one, point `GAME_URL` in `www/index.html`
at your https URL (and add it to the CSP `frame-src` + `config.xml`).

## Quick start

```bash
npm install -g cordova
npm install
cordova platform add android
cordova run android        # device or emulator
```

Requirements: Android SDK + JDK 17 (`cordova requirements android` to verify).

## Release builds

1. Create your own keystore:
   `keytool -genkey -v -keystore release.keystore -alias your-alias -keyalg RSA -keysize 2048 -validity 10000`
2. `cp build.json.example build.json` and fill in your passwords.
   **`build.json` and `*.keystore` are gitignored — never commit them.**
3. `npm run build:release`

## Make it yours

- `package.json` + `config.xml` — app id, name, `URL_SCHEME` (deep-link callback scheme)
- `cordova-plugin-mwa/src/android/MWAPlugin.java` — `IDENTITY_URI` / `IDENTITY_NAME`
  constants shown in the wallet approval dialog (and the Java package if you rename the app id)
- `www/index.html` — branding, and the deep-link `app_url` / `redirect_link`
- `www/game/` — replace the clicker with your game
- `res/icon/android/` — app icons

## License

MIT
