# MultiCast

**Made by Maitrik Ghetiya**

MultiCast is a cross-platform wireless screen-casting and synchronized audio sharing platform enabling a single source computer to broadcast its display, application window, or browser tab to up to **9 receiver displays** (**10 connected devices total** per room, including the source) across Windows and macOS using WebRTC and Socket.IO.

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite (`dist/` served by Express in production)
- **Backend & Signaling**: Unified Node.js server (`server.ts`) running Express + Socket.IO on the same origin
- **Authentication & User Storage**: Firebase Authentication (Google Sign-In, Email/Password + Email Verification, Forgot/Reset Password, Mobile Phone OTP) + Firestore (`/users/{uid}` profiles & recent rooms) + Server-side Firebase ID token verification (`firebase-admin` / project-verified tokens)
- **Media Transport**: Peer-to-peer 1-to-many WebRTC (`RTCPeerConnection`, `navigator.mediaDevices.getDisplayMedia`) with separate video and audio track lifecycle management and per-room authenticated TURN credentials

### Key Runtime Endpoints

- `GET /health` & `GET /api/health`: Liveness, active room count, receiver count, device cap (`maxTotalDevicesPerRoom: 10`), configured room lifetime, and Firebase auth readiness
- `GET /api/auth/session`: Protected endpoint verifying the caller's Firebase ID token (`Authorization: Bearer <idToken>`) and returning verified user/admin status and server room limits
- `POST /api/auth/otp-preflight`: Rate-limited SMS OTP preflight guard (IP + SHA-256 hashed phone throttling) before Firebase Phone Auth challenges
- `GET /api/ice-config`: Returns public STUN servers to unauthenticated callers; returns TURN credentials (`turnAuthorized: true`) only to callers presenting a valid room token
- `GET /api/sessions/:code`: Validates active room availability, total connected device count (`totalDevices` / `maxTotalDevices`), receiver capacity, and expiration status without leaking PINs or secrets
- `/socket.io`: Same-origin WebSocket + polling signaling endpoint with WSS reverse-proxy compatibility, origin allowlist validation, and embedded ICE config in room create/join acknowledgements

## Room Lifetime & 10-Device Limit

- **10 Devices Total Maximum**: Every room supports up to **10 connected devices total** — **1 source device** plus up to **9 receiver devices** (`MAX_RECEIVERS_PER_ROOM` is capped at `9`).
- **Duplicate Device Prevention & Reconnection**: Clients generate a persistent `deviceId`. If a receiver reconnects or refreshes from the same browser/device, its previous slot is replaced rather than consuming an extra device slot. Disconnecting or removing a receiver immediately frees its slot.
- **Configurable Long-Lived Rooms**: Controlled via `ROOM_MAX_LIFETIME` (e.g., `4h`, `12h`, `24h`, `3d`, `7d`, `30d`, or `0` / `unlimited`) and `ROOM_MAX_LIFETIME_MS`. Hosts can select room lifetimes up to the server limit; configured administrators (`ADMIN_EMAILS`) can extend room lifetimes up to `30d` or `0` (idle cleanup only). Inactive rooms are cleaned up automatically after `ROOM_IDLE_TTL_MS`.
- **In-Memory Signaling State**: Active rooms live in server memory; restarting the Node.js server clears active rooms and connected sockets cleanly.

## Firebase Authentication Setup

MultiCast protects room creation (`session:create`), `/cast`, `/profile`, and `/api/auth/session` with Firebase ID token verification, while receivers can join any room directly via `/join` with a 6-character Room Code and PIN.

1. **Firebase Project Config**: This repository includes `firebase-applet-config.json` (used for client SDK initialization) and supports `FIREBASE_PROJECT_ID` on the backend. For Firebase Admin SDK outside Google Cloud / Application Default Credentials, configure `GOOGLE_APPLICATION_CREDENTIALS` or deploy on Cloud Run/GCP.
2. **Enable Sign-In Providers in Firebase Console → Authentication → Sign-in method**:
   - **Google**: Enable Google provider and add your support email.
   - **Email/Password**: Enable Email/Password. Unverified email accounts are prompted to verify their inbox before creating rooms. Password resets are handled via Firebase reset links (`/?mode=resetPassword&oobCode=...`).
   - **Phone (Mobile OTP)**: Enable Phone provider.
3. **Authorized Domains**: Under **Authentication → Settings → Authorized domains**, add `localhost`, your local LAN domain if needed, and your production HTTPS domain (e.g., `multicast.yourdomain.com`).
4. **SMS Billing & Test Phone Numbers (Important)**:
   - Real SMS OTP delivery on Firebase Phone Auth requires a **Firebase Blaze (Pay-as-You-Go) plan** and Identity Platform SMS billing quotas (Firebase Spark/free plans include a tiny daily SMS limit and require **reCAPTCHA** verification, which MultiCast wires via invisible `RecaptchaVerifier`).
   - For zero-cost development/QA testing without sending real SMS messages, add **Phone numbers for testing** (e.g. `+1 650-555-3434` with verification code `123456`) under **Firebase Console → Authentication → Sign-in method → Phone → Phone numbers for testing**.

## Environment Variables

Copy `.env.example` to `.env` for local development (`.env` is gitignored and never committed):

```bash
cp .env.example .env
```

- **`PORT`**: Server listening port (`3000` in development, `8080` default in production)
- **`NODE_ENV`**: `development` or `production`
- **`TRUST_PROXY`**: Set automatically in production (`true`) so `req.protocol` and `X-Forwarded-Proto` resolve behind HTTPS reverse proxies
- **`APP_URL` / `CORS_ORIGIN`**: Canonical HTTPS URL and comma-separated origin allowlist (wildcard `*` is blocked)
- **`ICE_SERVERS` / `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` / `TURN_SHARED_SECRET`**: STUN and private TURN server configuration (secrets remain strictly on the server)
- **`MAX_ACTIVE_ROOMS` / `MAX_RECEIVERS_PER_ROOM`**: Capacity limits (`200` rooms / up to `9` receivers = `10` total devices max)
- **`ROOM_IDLE_TTL_MS` / `ROOM_MAX_LIFETIME` / `ROOM_MAX_LIFETIME_MS` / `ROOM_AUTH_SECRET`**: Idle timeout, configurable room max lifetime (`24h` default, `7d`, `30d`, `unlimited`), and HMAC room signing secret
- **`FIREBASE_PROJECT_ID` / `ADMIN_EMAILS`**: Server-side Firebase token audience/issuer project check and comma-separated administrator emails allowed to configure unlimited room lifetimes

## Local Development

```bash
npm install
npm run dev
```

## Production Build & Deployment

MultiCast runs as a **single unified Node.js service** on Render, Google Cloud Run, or Docker (never split frontend and backend):

```bash
npm install
npm run lint
npm run typecheck:server
npm run build
NODE_ENV=production npm start
```

### Render / Cloud Run Checklist

- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start` (`node server.ts`)
- **Health Check Path**: `/health` or `/api/health`
- **WebSockets & HTTPS**: Standard HTTPS termination (`wss://` upgrades work out-of-the-box via `TRUST_PROXY=true` and same-origin Socket.IO `/socket.io`)

## Using MultiCast

1. Sign in via **Account** (Google, Email & Password with email verification, or Mobile OTP) on the source computer.
2. Open **Source Broadcaster**, choose your **Room Capacity** (up to 9 receivers / 10 devices total) and **Room Lifetime**, optionally set a custom PIN, and click **Start Sharing**.
3. Share the **Room Code**, numeric **PIN**, **QR code**, or **Copy Room Link** with receiver devices.
4. On each receiver computer, open **Receiver Display**, scan the QR code or enter the Room Code + PIN, and click **Join Room**.
5. Receiver shortcuts: press **`F`** (or double-click video) for true fullscreen (`Esc` exits), and **`M`** to mute/unmute audio. Fullscreen displays only the scaled video stream inside the browser viewport (browser-native OS permission banners or ESC hints remain controlled by the browser/OS).
6. On a TV, open **`/tv`**, enter the same Room Code + PIN with the remote, then use the on-screen controls or remote keys (`F` fullscreen, `M` audio, `Back`/`Esc` leave). After connecting, the optional QR code opens the same room on a phone; it contains the room code only, never the PIN.

### Smart TV Receiver Status

The `/tv` page checks for the browser's WebRTC peer-connection and media playback APIs before enabling room joins. A detected API is only a browser capability check; it is **not** evidence that a specific television model can successfully decode and play the stream.

No physical Android TV / Google TV, Samsung Tizen, LG webOS, or Fire TV hardware playback, audio, fullscreen, or remote-navigation validation is claimed by this project version. Treat each model/browser combination as unverified until real video and audio playback and remote controls have been tested on that device. The incoming stream is fitted to the display and is not upscaled by the TV page; actual 720p/1080p playback depends on the source stream, browser decoder, and television.

## Browser Screen & Audio Capture Compatibility

| Desktop Browser | Full Display | Application Window | Browser Tab | Audio Capture |
| --- | --- | --- | --- | --- |
| **Google Chrome (72+)** — Windows / macOS | Yes | Yes | Yes | Tab audio (Win/macOS) & System audio (Win / macOS 13+) |
| **Microsoft Edge (79+)** — Windows / macOS | Yes | Yes | Yes | Tab audio (Win/macOS) & System audio (Windows) |
| **Mozilla Firefox (66+)** — Windows / macOS | Yes | Yes | Via Window | Video-only on most platforms |
| **Apple Safari (14+)** — macOS | Yes | Yes (macOS 14+) | Via Window | Video-only in standard picker |

- Screen capture (`getDisplayMedia`) requires HTTPS (or `http://localhost`) and a direct user click.
- Browser autoplay policies may pause unmuted receiver audio on first load; MultiCast renders a dedicated offscreen-opacity `<audio>` element (compatible with Safari WebKit) and surfaces an explicit **Enable Audio** unlock button plus honest 4-state status (`Audio Connected`, `Audio Available`, `Audio Muted`, `Audio Unavailable`).

### Android Phone Source and Receiver

On Android, use **Source Broadcaster** and tap **Start Broadcasting**. MultiCast enables capture only when the secure page exposes `navigator.mediaDevices.getDisplayMedia`; approve the Android screen-capture prompt. The source defaults to the existing mobile 720p / 30 fps adaptive preset, and captured video dimensions are refreshed after orientation changes. Capture ending from Android controls or the browser is detected and stops the broadcast cleanly. The page warns before leaving while a capture track is active, but mobile browsers may not provide that warning for every OS navigation path.

Audio is requested only when the sender's audio option is enabled. Availability depends on Android version, browser, selected share surface, and the system prompt; MultiCast reports **Audio Available** only when the returned stream has a live audio track. A device/browser exposing `getDisplayMedia` is not proof of working hardware capture or audio. Backgrounding or locking may suspend or end capture; keep MultiCast open and check the preview when returning.

Android phones can also join through **Receiver Display** using a code, invitation link, or QR scanner. Receiver playback, explicit audio unlock/mute, fullscreen, network quality, and signaling/WebRTC reconnect use the existing receiver implementation. Any source can invite Android as one of up to nine receivers; the backend continues to enforce 10 total devices per room.

No physical Android phone/browser matrix has been validated in this repository version. Android Chrome, Samsung Internet, and other browsers remain **unverified on real devices** for permission flow, system audio, orientation, backgrounding, and multi-receiver stability. Cross-device combinations (Android source/receiver with iPhone, Mac, Windows, or Android TV) are not declared hardware-supported based on website loading or API presence alone. Validate actual captured frames and audio, reconnect behavior, and every receiver before claiming support.
