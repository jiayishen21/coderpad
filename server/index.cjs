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
const {
  docs,
  getYDoc,
  setPersistence,
  setupWSConnection,
} = require("./yjsServer.cjs");
const { executeCode } = require("./executor.cjs");

const PORT = Number(process.env.PORT || 3000);
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || 2 * 60 * 1000);
const DOC_EVICTION_GRACE_MS = Number(process.env.DOC_EVICTION_GRACE_MS || 30000);
const DEFAULT_CODE = `function hello(name) {
  return \`Hello, \${name}!\`;
}

console.log(hello("interviewer"));
`;

async function main() {
  await initDatabase();
  configurePersistence(setPersistence);

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  app.use(express.json());
  app.use((req, _res, next) => {
    console.log(`[client] http ${req.method} ${req.originalUrl}`);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/sessions", async (_req, res, next) => {
    try {
      const sessionId = randomUUID();
      await createSession(sessionId);
      console.log(`[client] session=${sessionId} event=session:create`);
      res.status(201).json({ sessionId, url: `/session/${sessionId}` });
    } catch (error) {
      next(error);
    }
  });

  app.post("/sessions/:sessionId/run", async (req, res, next) => {
    const sessionId = req.params.sessionId;

    try {
      const sessionDoc = await getYDoc(sessionId);
      const session = readSessionState(sessionDoc);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      console.log(
        `[client] session=${sessionId} event=execution:start language=${session.language}`,
      );
      writeExecutionState(sessionDoc, {
        isRunning: true,
        error: "",
        result: null,
        updatedAt: new Date().toISOString(),
      });
      const result = await executeCode(session);
      writeExecutionState(sessionDoc, {
        isRunning: false,
        error: "",
        result,
        updatedAt: new Date().toISOString(),
      });
      console.log(
        `[client] session=${sessionId} event=execution:finish code=${result.run?.code}`,
      );
      res.json(result);
    } catch (error) {
      const activeDoc = docs.get(sessionId);

      if (activeDoc) {
        writeExecutionState(activeDoc, {
          isRunning: false,
          error: error.message || "Code execution failed.",
          result: null,
          updatedAt: new Date().toISOString(),
        });
      }

      next(error);
    }
  });

  serveClient(app);

  server.on("upgrade", (request, socket, head) => {
    console.log(`[client] http UPGRADE ${request.url}`);

    if (!request.url?.startsWith("/yjs/")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const docName = decodeURIComponent(request.url.slice("/yjs/".length).split("?")[0]);
      setupWSConnection(ws, request, { docName }).catch((error) => {
        console.error(`Failed to set up websocket for ${docName}`, error);
        ws.close();
      });
    });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || "Internal server error" });
  });

  const flushTimer = setInterval(() => flushActiveSessions(docs), FLUSH_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`CoderPad clone listening on http://localhost:${PORT}`);
    console.log(
      `[server] flushIntervalMs=${FLUSH_INTERVAL_MS} docEvictionGraceMs=${DOC_EVICTION_GRACE_MS}`,
    );
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
        console.log(`[client] session=${docName} event=persistence:load bytes=${snapshot.length}`);
      } else {
        console.log(`[client] session=${docName} event=persistence:miss`);
      }
    },
    writeState: async (docName, ydoc) => {
      await saveYDoc(docName, ydoc);
      console.log(`[client] session=${docName} event=persistence:write-final`);
    },
  });
}

async function createSession(sessionId) {
  const ydoc = new Y.Doc();
  ydoc.getMap("metadata").set("language", "javascript");
  ydoc.getText("monaco").insert(0, DEFAULT_CODE);
  await saveYDoc(sessionId, ydoc);
  ydoc.destroy();
}

async function getSessionState(sessionId) {
  const activeDoc = docs.get(sessionId);

  if (activeDoc) {
    return readSessionState(activeDoc);
  }

  const snapshot = await loadSnapshot(sessionId);

  if (!snapshot) {
    return null;
  }

  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(snapshot));
  const session = readSessionState(ydoc);
  ydoc.destroy();
  return session;
}

function readSessionState(ydoc) {
  return {
    code: ydoc.getText("monaco").toString(),
    language: ydoc.getMap("metadata").get("language") || "javascript",
  };
}

function writeExecutionState(ydoc, executionState) {
  ydoc.getMap("metadata").set("execution", executionState);
}

async function flushActiveSessions(docs) {
  console.log(`[client] event=persistence:flush-active count=${docs.size}`);
  await Promise.all(
    Array.from(docs.entries()).map(([docName, ydoc]) => saveYDoc(docName, ydoc)),
  );
}

async function saveYDoc(docName, ydoc) {
  const snapshot = Y.encodeStateAsUpdate(ydoc);
  await saveSnapshot(docName, snapshot);
  console.log(`[client] session=${docName} event=persistence:saved bytes=${snapshot.byteLength}`);
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
