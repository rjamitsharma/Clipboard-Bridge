# cPanel Deployment (Node.js App)

This app is ready to run on cPanel using **Setup Node.js App**.

## 1) Upload project
- Upload the `clipboard-webapp` folder to your cPanel account (for example under `/home/<cpanel_user>/clipboard-webapp`).
- Keep both `server.js` and `app.js` in project root.

## 2) Create Node.js app in cPanel
- Open **Setup Node.js App**.
- Create app with:
  - Node.js version: `18+`
  - Application mode: `Production`
  - Application root: your uploaded folder path
  - Application URL: your domain/subdomain
  - Application startup file: `app.js`

## 3) Install dependencies
From cPanel Terminal (inside app root):

```bash
npm install --omit=dev
```

## 4) Restart app
- Use **Restart** in cPanel Node.js App panel.

## 5) Verify
- Open your app URL.
- Create and join session from two devices.
- Check text + file relay flows.

## Optional environment variables
Set from cPanel Node.js App env section if needed:
- `PORT` (usually managed by cPanel)
- `NODE_ENV=production`

## Notes
- This app currently uses **server relay path only** for text/files.
- Socket.IO works under the same domain as the app URL.
