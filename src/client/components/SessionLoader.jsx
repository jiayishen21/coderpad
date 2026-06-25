import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import Editor from "./Editor.jsx";
import Toolbar from "./Toolbar.jsx";

const USER_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ef4444", "#14b8a6"];
const DEFAULT_LANGUAGE = "javascript";

export default function SessionLoader({ sessionId }) {
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [synced, setSynced] = useState(false);
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
    const handleStatus = ({ status }) => {
      setConnected(status === "connected");
      setConnectionError("");

      if (status !== "connected") {
        setSynced(false);
      }
    };
    const handleConnectionError = () => {
      setConnectionError("Connection lost. Reconnecting...");
    };
    const handleSync = (isSynced) => {
      setSynced(isSynced);
    };

    provider.awareness.setLocalStateField("user", user);
    provider.on("status", handleStatus);
    provider.on("connection-error", handleConnectionError);
    provider.on("sync", handleSync);
    provider.connect();

    return () => {
      provider.off("status", handleStatus);
      provider.off("connection-error", handleConnectionError);
      provider.off("sync", handleSync);
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  useEffect(() => {
    const metadata = ydoc.getMap("metadata");

    function syncLanguage() {
      setLanguage(metadata.get("language") || DEFAULT_LANGUAGE);
    }

    syncLanguage();
    metadata.observe(syncLanguage);

    return () => metadata.unobserve(syncLanguage);
  }, [ydoc]);

  function handleLanguageChange(nextLanguage) {
    if (nextLanguage === language) {
      return;
    }

    const confirmed = window.confirm(
      `Changing the language to ${nextLanguage} will clear the shared file for everyone in this session. Continue?`,
    );

    if (!confirmed) {
      return;
    }

    const metadata = ydoc.getMap("metadata");
    const text = ydoc.getText("monaco");

    ydoc.transact(() => {
      metadata.set("language", nextLanguage);
      text.delete(0, text.length);
    });
  }

  return (
    <main className="workspace">
      <Toolbar
        connected={connected}
        language={language}
        sessionId={sessionId}
        onLanguageChange={handleLanguageChange}
      />
      {connectionError && <div className="connectionBanner">{connectionError}</div>}
      {synced ? (
        <Editor language={language} provider={provider} ydoc={ydoc} />
      ) : (
        <div className="loadingPanel">Loading session...</div>
      )}
    </main>
  );
}

function buildUser() {
  const name = `User ${Math.floor(Math.random() * 900 + 100)}`;
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

  return { name, color };
}
