# CoderPad Clone

A lightweight collaborative code editor built with React, Monaco, Yjs, Express,
WebSockets, and Postgres.

## Local Development

Start the Postgres database in Docker:

```sh
npm run db:up
```

Install dependencies and start the app:

```sh
npm install
npm run dev
```

The Vite client runs on `http://localhost:5173`, and the Node/WebSocket server
runs on `http://localhost:3000`. The server defaults to:

```sh
DATABASE_URL=postgres://coderpad:coderpad@localhost:5432/coderpad
UPDATE_SAVE_DEBOUNCE_MS=500
DOC_EVICTION_GRACE_MS=30000
```

## Production Build

```sh
npm run build
npm start
```

In production, Express serves the built React app from `dist` and handles both
`POST /sessions` and websocket sync at `/yjs/:sessionId`.
