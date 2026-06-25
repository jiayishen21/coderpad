const Y = require("yjs");
const awarenessProtocol = require("y-protocols/awareness");
const syncProtocol = require("y-protocols/sync");
const decoding = require("lib0/decoding");
const encoding = require("lib0/encoding");

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_OPEN = 1;
const PING_TIMEOUT_MS = 30000;
const DOC_EVICTION_GRACE_MS = Number(process.env.DOC_EVICTION_GRACE_MS || 30000);

const docs = new Map();
const evictionTimers = new Map();
let persistence = null;

function setPersistence(nextPersistence) {
  persistence = nextPersistence;
}

async function setupWSConnection(conn, req, { docName = getDocName(req), gc = true } = {}) {
  conn.binaryType = "arraybuffer";

  const doc = await getYDoc(docName, gc);
  cancelEviction(docName);
  doc.conns.set(conn, new Set());
  logClientEvent(docName, "ws:connect", {
    connections: doc.conns.size,
    url: req.url,
  });

  conn.on("message", (message) => {
    readMessage(conn, doc, new Uint8Array(message));
  });

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      closeConn(doc, conn);
      clearInterval(pingInterval);
      return;
    }

    if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch (_error) {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, PING_TIMEOUT_MS);

  conn.on("close", () => {
    logClientEvent(doc.name, "ws:close", { connections: Math.max(0, doc.conns.size - 1) });
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });
  conn.on("pong", () => {
    logClientEvent(doc.name, "ws:pong");
    pongReceived = true;
  });

  sendInitialSync(conn, doc);
  sendAwarenessStates(conn, doc);
}

async function getYDoc(docName, gc = true) {
  if (docs.has(docName)) {
    cancelEviction(docName);
    logClientEvent(docName, "doc:reuse-memory");
    return docs.get(docName);
  }

  logClientEvent(docName, "doc:create-memory");
  const doc = new Y.Doc({ gc });
  doc.name = docName;
  doc.conns = new Map();
  doc.awareness = new awarenessProtocol.Awareness(doc);
  doc.awareness.setLocalState(null);

  doc.on("update", (update, origin) => {
    broadcastUpdate(doc, update, origin);
  });
  doc.awareness.on("update", (changes, origin) => {
    broadcastAwareness(doc, changes, origin);
  });

  docs.set(docName, doc);

  if (persistence) {
    await persistence.bindState(docName, doc);
  }

  return doc;
}

function readMessage(conn, doc, message) {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    logClientEvent(doc.name, `ws:message:${messageTypeToName(messageType)}`, {
      bytes: message.byteLength,
      connections: doc.conns.size,
    });

    switch (messageType) {
      case MESSAGE_SYNC:
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      default:
        logClientEvent(doc.name, "ws:message:unknown", { messageType });
        break;
    }
  } catch (error) {
    console.error("Caught error while handling a Yjs message", error);
  }
}

function broadcastUpdate(doc, update, origin) {
  logClientEvent(doc.name, "yjs:update", {
    bytes: update.byteLength,
    connections: doc.conns.size,
  });

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);

  doc.conns.forEach((_controlledIds, conn) => {
    if (conn !== origin) {
      send(doc, conn, message);
    }
  });
}

function broadcastAwareness(doc, { added, updated, removed }, origin) {
  const changedClients = added.concat(updated, removed);
  logClientEvent(doc.name, "awareness:update", {
    added: added.length,
    updated: updated.length,
    removed: removed.length,
    connections: doc.conns.size,
  });

  if (origin && doc.conns.has(origin)) {
    const controlledIds = doc.conns.get(origin);
    added.forEach((clientId) => controlledIds.add(clientId));
    removed.forEach((clientId) => controlledIds.delete(clientId));
  }

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changedClients),
  );
  const message = encoding.toUint8Array(encoder);

  doc.conns.forEach((_controlledIds, conn) => {
    if (conn !== origin) {
      send(doc, conn, message);
    }
  });
}

function sendInitialSync(conn, doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, encoding.toUint8Array(encoder));

  const stateEncoder = encoding.createEncoder();
  encoding.writeVarUint(stateEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(stateEncoder, doc);
  send(doc, conn, encoding.toUint8Array(stateEncoder));
  logClientEvent(doc.name, "ws:send:initial-sync");
}

function sendAwarenessStates(conn, doc) {
  const awarenessStates = doc.awareness.getStates();

  if (awarenessStates.size === 0) {
    return;
  }

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
  );
  send(doc, conn, encoding.toUint8Array(encoder));
}

function closeConn(doc, conn) {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);

    if (doc.conns.size === 0) {
      flushAndScheduleEviction(doc);
    }
  }

  if (conn.readyState === WS_READY_STATE_OPEN || conn.readyState === WS_READY_STATE_CONNECTING) {
    conn.close();
  }
}

function flushAndScheduleEviction(doc) {
  const docName = doc.name;

  logClientEvent(docName, "doc:last-client-left", {
    evictionGraceMs: DOC_EVICTION_GRACE_MS,
  });

  Promise.resolve(persistence?.writeState(docName, doc)).catch((error) => {
    console.error(`Failed to persist ${docName}`, error);
  });

  cancelEviction(docName);
  const timeout = setTimeout(() => {
    if (doc.conns.size > 0) {
      logClientEvent(docName, "doc:eviction-cancelled", { connections: doc.conns.size });
      return;
    }

    logClientEvent(docName, "doc:evict-memory");
    doc.destroy();
    docs.delete(docName);
    evictionTimers.delete(docName);
  }, DOC_EVICTION_GRACE_MS);

  evictionTimers.set(docName, timeout);
}

function cancelEviction(docName) {
  const timeout = evictionTimers.get(docName);

  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  evictionTimers.delete(docName);
  logClientEvent(docName, "doc:eviction-cancelled");
}

function send(doc, conn, message) {
  if (conn.readyState !== WS_READY_STATE_CONNECTING && conn.readyState !== WS_READY_STATE_OPEN) {
    closeConn(doc, conn);
    return;
  }

  try {
    conn.send(message, {}, (error) => {
      if (error) {
        closeConn(doc, conn);
      }
    });
  } catch (_error) {
    closeConn(doc, conn);
  }
}

function getDocName(req) {
  return (req.url || "").slice(1).split("?")[0];
}

function messageTypeToName(messageType) {
  switch (messageType) {
    case MESSAGE_SYNC:
      return "sync";
    case MESSAGE_AWARENESS:
      return "awareness";
    default:
      return "unknown";
  }
}

function logClientEvent(docName, event, data = {}) {
  const suffix = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : "";
  console.log(`[client] session=${docName} event=${event}${suffix}`);
}

module.exports = {
  docs,
  setPersistence,
  setupWSConnection,
};
