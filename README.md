# Quick Chat

Cross-device clipboard and file sharing with QR pairing — installable as a PWA.

## Features

- **QR session pairing** — one device creates a session and shows a QR code; the other scans it or enters the key manually
- **Text sharing** — send text between two devices in real time via Socket.IO relay (LAN-first, internet fallback)
- **File sharing** — send files up to 100 MB with chunked transfer, preview thumbnails, and download progress
- **Drag-and-drop upload** — drag files directly into the chat area (Telegram-style)
- **Camera capture** — take a photo directly from the browser to share instantly
- **Connection indicator** — green/red dot shows peer connection status
- **Session persistence** — reload-safe: chat history (text + file metadata) survives page refresh via localStorage (5 min TTL)
- **History sync** — when one peer reconnects, it fetches full chat including file payloads from the connected peer
- **URL sync** — browser URL always reflects the current session code via `history.replaceState`
- **Auto-reconnect** — server keeps sessions alive for 10 minutes after disconnect
- **File error handling** — stale file offers auto-cancel with "Sender disconnected" message + 30s timeout
- **Nearby sessions** — discover open sessions on the same LAN
- **Camera QR scanning** — scan QR codes using the device camera
- **Media viewer** — fullscreen preview with download + hold-to-save context menu
- **PWA installable** — add to home screen or desktop as a standalone app

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Node.js, Express, Socket.IO         |
| Frontend | Vanilla JS, CSS                     |
| QR       | `qrcode` (server), `html5-qrcode` (client) |
| Uploads  | Multer (in-memory, 100 MB limit)    |
| PWA      | Web App Manifest, Service Worker    |

## Getting Started

### Prerequisites

- Node.js >= 18

### Install & Run

```bash
npm install
npm run dev
```

Server starts at `http://0.0.0.0:3000`.

### Usage

1. Open the app on **Device A**. The join panel is shown by default — enter a session key, or click **Create Session** to start a new one.
2. A QR code appears. Scan it with **Device B** (or enter the session code manually).
3. Both devices connect. Send text or files (images, videos, PDFs). Drag-and-drop also works.
4. The green dot shows `Peer connected`. If the other device disconnects, it turns red.
5. Reload the page — messages persist and the session auto-reconnects (if the peer is still online, file data is synced too).
6. Click **Leave** to quit (confirm dialog prevents accidental exit).

To connect over LAN, use the device's local IP address (e.g. `http://192.168.1.10:3000`).

## Environment Variables

| Variable      | Default | Description      |
|---------------|---------|------------------|
| `PORT`        | `3000`  | Server port      |
| `NODE_ENV`    | —       | Set to `production` for deployments |

## cPanel Deployment

### Node.js App Setup

1. Upload files to your application root (e.g. `public_html/q.bhavyaai.com`).
2. In cPanel **Setup Node.js App**:
   - Application mode: `Production`
   - Application root: path to your files
   - Application URL: your domain
   - Application startup file: `app.js`
3. Click **Run NPM Install**.
4. Start the app.

### .htaccess

If needed, create an `htaccess` file (not committed to git) in the app root to set the Node.js Passenger path:
```
PassengerStartupFile standalone/server.js
PassengerNodejs /home2/USER/nodevenv/DOMAIN/22/bin/node
PassengerAppRoot /home2/USER/public_html/q.bhavyaai.com
PassengerFriendlyErrorPages off
```

## PWA Installation

Open the app in Chrome or Edge — the browser toolbar shows an install icon. Click it to install as a standalone desktop/mobile app.

## API Endpoints

| Method | Path                    | Description                     |
|--------|-------------------------|---------------------------------|
| GET    | `/api/session`          | Create a new session (returns ID) |
| GET    | `/api/qr?text=...`      | Generate QR code data URL       |
| GET    | `/api/sessions/nearby`  | List nearby open sessions       |
| POST   | `/api/upload/:session`  | Direct file upload to session   |
| POST   | `/api/session/:id/ping` | Keep session alive              |

## License

MIT
