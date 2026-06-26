# CoderPad Clone

A lightweight collaborative code editor built with React, Monaco, Yjs, Express,
WebSockets, and Postgres.

## Local Development

Install dependencies:

```sh
npm install
```

Start Postgres and Piston in Docker:

```sh
npm run db:up
```

Install the Piston runtimes used by the app:

```sh
npm run piston:install-runtimes
```

Start the app:

```sh
npm run dev
```

The Vite client runs on `http://localhost:5173`, and the Node/WebSocket server
runs on `http://localhost:3000`. The server defaults to:

```sh
DATABASE_URL=postgres://coderpad:coderpad@localhost:5432/coderpad
DOC_EVICTION_GRACE_MS=30000
PISTON_URL=http://localhost:2000
EXECUTION_RUN_TIMEOUT_MS=3000
EXECUTION_COMPILE_TIMEOUT_MS=5000
EXECUTION_MAX_SOURCE_BYTES=65536
```

## Production Build

```sh
npm run build
npm start
```

In production, Express serves the built React app from `dist` and handles
`POST /sessions`, `POST /sessions/:sessionId/run`, and websocket sync at
`/yjs/:sessionId`.

## Render Piston Service

Create a separate Render Web Service for Piston from this repo:

```text
Language: Docker
Root Directory: leave blank
Dockerfile Path: services/piston/Dockerfile
Docker Build Context Directory: .
Docker Command: leave blank
Pre-Deploy Command: leave blank
```

Set the Piston service environment:

```sh
PORT=2000
```

If Render offers a persistent disk for the service, mount it at:

```text
/piston
```

The Piston image installs Python, Node/JavaScript, and TypeScript runtimes during
service startup if they are missing.

Then set the main app service to use that Piston URL:

```sh
PISTON_URL=https://your-piston-service.onrender.com
```
