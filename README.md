# Workflow System

A browser-based customer queue and preparation workflow for four screens:

- Main menu: `/`
- Customer sign-in tablet: `/signin.html`
- Front desk dashboard: `/desk.html`
- Preparation screen: `/installers.html`
- Public TV queue: `/display.html`

The application uses plain HTML, CSS, JavaScript, and a Node.js backend. It is not a Next.js or React app.

## Does This Need A Backend?

Yes. The frontend can be hosted anywhere, but the app requires the Node backend for:

- Creating customer sign-ins
- Updating statuses and comments
- Showing done orders
- Keeping every screen live with Server-Sent Events
- Persisting queue data in `data/queue.json` or the path set by `DATA_FILE`

The easiest production deployment is one Node server running both the frontend and backend together.

## Requirements

- Node.js 20 or newer
- A normal web browser: Chrome, Edge, Firefox, or Safari

## Environment Variables

Copy `.env.example` when you need environment-specific values.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | HTTP port for the Node server. |
| `HOST` | No | `0.0.0.0` | Bind address. Use `0.0.0.0` so tablets, TVs, and employees can connect on the network. |
| `ACCESS_PIN` | No | `7875` | PIN used when exiting customer sign-in. Change this for production. |
| `DATA_FILE` | No | `./data/queue.json` | JSON persistence file for queue data. Use a mounted volume on a server. |
| `PUBLIC_API_BASE_URL` | No | empty | Browser API base URL. Leave empty when frontend and backend are same-origin. |
| `CORS_ORIGIN` | No | empty | Allowed frontend origin when frontend and backend are on different domains. |

## Local Run

```sh
npm install
npm run build
npm start
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/signin.html`
- `http://localhost:3000/desk.html`
- `http://localhost:3000/installers.html`
- `http://localhost:3000/display.html`

For other devices on the same Wi-Fi, find the computer's local IP address and open:

```text
http://YOUR-COMPUTER-IP:3000/
```

## Production: Self-Hosted Server

This is the recommended deployment because it runs the live backend and frontend together.

1. Copy the project to your server.
2. Install Node.js 20 or newer.
3. Create a production environment file or set environment variables:

```sh
PORT=3000
HOST=0.0.0.0
ACCESS_PIN=change-this-pin
DATA_FILE=/var/lib/workflow-system/queue.json
PUBLIC_API_BASE_URL=
CORS_ORIGIN=
```

4. Start the app:

```sh
npm install
npm run build
npm start
```

5. Put a reverse proxy such as Nginx, Caddy, or your hosting provider in front of port `3000` for HTTPS.
6. Make sure the directory used by `DATA_FILE` is writable and backed up.

Health check:

```sh
curl http://localhost:3000/api/health
```

## Production: Docker

```sh
docker build -t workflow-system .
docker run -p 3000:3000 \
  -e ACCESS_PIN=change-this-pin \
  -e DATA_FILE=/data/queue.json \
  -v workflow-system-data:/data \
  workflow-system
```

Open `http://localhost:3000/`.

## Production: Vercel

Vercel deployment in this repo is configured for the static frontend only. Deploy the Node backend separately first, then point the Vercel frontend at it.

1. Deploy the backend on a Node host using the self-hosted or Docker steps above.
2. Set the backend environment variable:

```sh
CORS_ORIGIN=https://your-vercel-site.vercel.app
```

3. In Vercel, import this repository.
4. Use the included `vercel.json`.
5. Set this Vercel environment variable:

```sh
PUBLIC_API_BASE_URL=https://your-backend-domain.com
```

6. Deploy. Vercel will publish the `public` folder and generate `public/env.js` during the build.

## Production: Netlify

Netlify deployment in this repo is configured for the static frontend only. Deploy the Node backend separately first, then point the Netlify frontend at it.

1. Deploy the backend on a Node host using the self-hosted or Docker steps above.
2. Set the backend environment variable:

```sh
CORS_ORIGIN=https://your-netlify-site.netlify.app
```

3. In Netlify, import this repository.
4. Use the included `netlify.toml`.
5. Set this Netlify environment variable:

```sh
PUBLIC_API_BASE_URL=https://your-backend-domain.com
```

6. Deploy. Netlify will publish the `public` folder and generate `public/env.js` during the build.

## Browser Compatibility

The app uses standard browser features:

- HTML, CSS, and ES modules
- `fetch`
- `EventSource`
- `localStorage` and `sessionStorage`

These are supported by current Chrome, Edge, Firefox, and Safari. No Codex preview APIs or Codex-only URLs are required.

## Deployment Notes

- Same-origin deployment is simplest: one Node server, no CORS needed.
- Separate frontend/backend deployment requires `PUBLIC_API_BASE_URL` on the frontend and `CORS_ORIGIN` on the backend.
- Vercel and Netlify are not recommended for the backend because this app uses long-lived Server-Sent Events and file-based persistence.
- For real business data, back up `DATA_FILE` or replace the JSON file persistence with a managed database.
