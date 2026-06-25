# CoderPad Clone — Design Document

## Overview

A lightweight, real-time collaborative code editor for pair programming and technical interviews. Two or more users share a session link and can edit code simultaneously, with changes reflected instantly for all participants.

---

## Goals

- Real-time collaborative editing with no perceptible lag
- Simple session model: generate a link, share it, start coding
- Persist session state so a page refresh doesn't lose work
- Single-server deployment — no distributed systems complexity

## Non-Goals

- Multi-server horizontal scaling
- User accounts or authentication (sessions are link-based)
- Code execution (out of scope for v1)

---

## Tech Stack

| Layer         | Choice            | Reason                                                  |
| ------------- | ----------------- | ------------------------------------------------------- |
| Frontend      | React + Vite      | Fast dev experience, simple build                       |
| Editor        | Monaco Editor     | VS Code-quality editor, language support out of the box |
| CRDT          | Yjs + y-monaco    | Handles conflict resolution transparently               |
| Transport     | WebSockets (ws)   | Native support in y-websocket                           |
| WS sync layer | y-websocket       | Drop-in Yjs WebSocket server, minimal config            |
| Backend       | Node.js + Express | Same runtime as Yjs ecosystem                           |
| Database      | Postgres (Docker) | Periodic persistence of session state                   |

---

## Architecture

```
┌─────────────────────┐        ┌─────────────────────────────────────┐
│   Browser (User A)  │        │           Node.js Server            │
│                     │        │                                     │
│  Monaco Editor      │        │  Express  ──  REST API              │
│       ↕             │  WS    │                                     │
│  y-monaco binding   │◄──────►│  y-websocket  ──  in-memory Y.Doc   │
│       ↕             │        │                        ↕            │
│  Yjs Y.Doc          │        │              flush every 2 min      │
└─────────────────────┘        │                        ↕            │
                               │                   Postgres          │
┌─────────────────────┐        └─────────────────────────────────────┘
│   Browser (User B)  │
│                     │
│  Monaco Editor      │
│       ↕             │  WS
│  y-monaco binding   │◄──────►  (same server)
│       ↕             │
│  Yjs Y.Doc          │
└─────────────────────┘
```

All clients connect to the same Node.js process. The y-websocket layer fans out Yjs update blobs to all clients in a given room. The server holds the canonical `Y.Doc` in memory and flushes it to Postgres periodically.

---

## Session Model

Sessions are identified by a randomly generated ID (e.g. a UUID or nanoid). No user accounts are required.

**Create a session**

```
POST /sessions
← { sessionId: "abc123", url: "/session/abc123" }
```

**Join a session**

```
GET /session/:sessionId   → serves the React app
WS  /yjs/:sessionId       → y-websocket connection
```

On WebSocket connect, y-websocket checks if a `Y.Doc` for that session ID exists in memory. If not, it loads the latest snapshot from Postgres and hydrates the doc. All subsequent edits are handled in-memory.

---

## Conflict Resolution

Handled entirely by Yjs. No custom merging logic is written.

Yjs uses a CRDT (specifically the YATA algorithm) which assigns every character insertion a unique, stable ID based on client ID and a logical clock. Concurrent insertions are merged deterministically by sorting on these IDs — there is no concept of a "conflict" that requires manual resolution.

The `y-monaco` binding translates Monaco editor transactions into Yjs operations and vice versa automatically. Copy-paste, multi-cursor edits, and bulk deletions are all handled transparently.

---

## Persistence

**In-memory state:** The authoritative `Y.Doc` for each active session lives in the Node.js process memory. This is fast and requires no external coordination.

**Periodic flush:** Every 2 minutes, all active sessions are flushed to Postgres using `Y.encodeStateAsUpdate(doc)`, which produces a compact binary blob.

**Flush on last user leaving:** When the last WebSocket connection for a session closes, the session is immediately flushed to Postgres and evicted from memory. This bounds the worst-case data loss to 2 minutes (only during active sessions).

**Reload on rejoin:** When a user joins a session that has been evicted from memory, the server loads the binary blob from Postgres and calls `Y.applyUpdate(doc, snapshot)` to restore state.

**Postgres schema:**

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  snapshot    BYTEA NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Memory Management

Sessions accumulate in the in-memory map as users join. To prevent unbounded memory growth:

- When the last user disconnects from a session, flush and evict immediately
- A background job sweeps sessions with no active connections older than 10 minutes and evicts them (after flushing)

This keeps the in-memory footprint proportional to the number of currently active sessions, not all sessions ever created.

---

## Frontend

The frontend is a single-page React app served by Express.

**Key components:**

- `SessionLoader` — on mount, reads the session ID from the URL, establishes the WebSocket connection via `y-websocket`'s client provider, and passes the `Y.Doc` down
- `Editor` — wraps Monaco Editor and wires up the `y-monaco` binding
- `Toolbar` — language selector, copy link button

**Awareness (live cursors):**

Yjs has a built-in awareness protocol for sharing ephemeral state (cursor position, username, color) between clients. This is included in y-websocket and y-monaco by default and requires minimal setup:

```js
const awareness = provider.awareness;
awareness.setLocalStateField("user", {
  name: "User A",
  color: "#ff0000",
});
```

---

## Deployment

Single Node.js process on Railway or Render. No separate services required.

```
node server.js
```

The Express server and y-websocket server are mounted on the same HTTP server instance to keep everything in one process:

```js
const server = http.createServer(app);
setupWSConnection(server); // y-websocket mounts here
server.listen(3000);
```

Environment variables:

```
DATABASE_URL=postgres://...
PORT=3000
```

---

## Future Considerations (v2+)

- **Code execution:** Sandboxed execution via a container (e.g. Firecracker microVM or a third-party API like Piston)
- **Session history / playback:** Store Yjs update ops individually rather than snapshots to enable replay
- **Authentication:** Password-protected sessions or login-gated access
- **Horizontal scaling:** At this point, introduce Redis pub/sub so multiple Node instances can fan out Yjs updates across servers
