const express = require("express");
const http = require("http");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");
const Y = require("yjs");
const {
  closeDatabase,
  initDatabase,
  loadSnapshot,
  saveSnapshot,
} = require("./db.cjs");

const PORT = Number(process.env.PORT || 3000);
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 2 * 60 * 1000);
const DEFAULT_CODE = `function hello(name) {
  return \`Hello, \${name}!\`;
}

console.log(hello("interviewer"));
`;

async function main() {
  const { docs, setPersistence, setupWSConnection } = await import(
    "@y/websocket-server/utils"
  );

  await initDatabase();
  configurePersistence(setPersistence);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/sessions", async (_req, res, next) => {
    try {
      const sessionId = randomUUID();
      await createSession(sessionId);
      res.status(201).json({ sessionId, url: `/session/${sessionId}` });
    } catch (error) {
      next(error);
    }
  });

  serveClient(app);

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/yjs/")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const docName = decodeURIComponent(request.url.slice("/yjs/".length).split("?")[0]);
      setupWSConnection(ws, request, { docName });
    });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  const flushTimer = setInterval(() => flushActiveSessions(docs), FLUSH_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`CoderPad clone listening on http://localhost:${PORT}`);
  });

  process.on("SIGINT", () => shutdown(server, flushTimer, docs));
  process.on("SIGTERM", () => shutdown(server, flushTimer, docs));
}

function configurePersistence(setPersistence) {
  setPersistence({
    bindState: async (docName, ydoc) => {
      const snapshot = await loadSnapshot(docName);

      if (snapshot) {
        Y.applyUpdate(ydoc, new Uint8Array(snapshot));
      }
    },
    writeState: async (docName, ydoc) => {
      await saveYDoc(docName, ydoc);
    },
  });
}

async function createSession(sessionId) {
  const ydoc = new Y.Doc();
  ydoc.getText("monaco").insert(0, DEFAULT_CODE);
  await saveYDoc(sessionId, ydoc);
  ydoc.destroy();
}

async function flushActiveSessions(docs) {
  await Promise.all(
    Array.from(docs.entries()).map(([docName, ydoc]) => saveYDoc(docName, ydoc)),
  );
}

async function saveYDoc(docName, ydoc) {
  const snapshot = Y.encodeStateAsUpdate(ydoc);
  await saveSnapshot(docName, snapshot);
}

function serveClient(app) {
  const distPath = path.join(__dirname, "..", "dist");

  app.use(express.static(distPath));
  app.get(/^\/session\/.+$/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
  app.get("/", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

async function shutdown(server, flushTimer, docs) {
  clearInterval(flushTimer);
  await flushActiveSessions(docs);
  await closeDatabase();
  server.close(() => process.exit(0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
