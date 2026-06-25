import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import Editor from "./Editor.jsx";
import Toolbar from "./Toolbar.jsx";

const USER_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ef4444", "#14b8a6"];

export default function SessionLoader({ sessionId }) {
  const [language, setLanguage] = useState("javascript");
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const ydoc = useMemo(() => new Y.Doc(), [sessionId]);
  const provider = useMemo(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host =
      import.meta.env.DEV && window.location.port !== "3000"
        ? "localhost:3000"
        : window.location.host;

    return new WebsocketProvider(`${protocol}//${host}/yjs`, sessionId, ydoc, {
      connect: false,
    });
  }, [sessionId, ydoc]);

  useEffect(() => {
    const user = buildUser();

    provider.awareness.setLocalStateField("user", user);
    provider.on("status", ({ status }) => {
      setConnected(status === "connected");
      setConnectionError("");
    });
    provider.on("connection-error", () => {
      setConnectionError("Connection lost. Reconnecting...");
    });
    provider.connect();

    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  return (
    <main className="workspace">
      <Toolbar
        connected={connected}
        language={language}
        sessionId={sessionId}
        onLanguageChange={setLanguage}
      />
      {connectionError && <div className="connectionBanner">{connectionError}</div>}
      <Editor language={language} provider={provider} ydoc={ydoc} />
    </main>
  );
}

function buildUser() {
  const name = `User ${Math.floor(Math.random() * 900 + 100)}`;
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

  return { name, color };
}
