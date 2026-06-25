import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import Editor from "./Editor.jsx";
import Toolbar from "./Toolbar.jsx";

const USER_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ef4444", "#14b8a6"];
const DEFAULT_LANGUAGE = "javascript";
const MIN_EDITOR_PERCENT = 35;
const MAX_EDITOR_PERCENT = 80;

export default function SessionLoader({ sessionId }) {
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [executionState, setExecutionState] = useState({
    error: "",
    isRunning: false,
    result: null,
    updatedAt: "",
  });
  const [editorWidthPercent, setEditorWidthPercent] = useState(65);
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
      setExecutionState(
        metadata.get("execution") || {
          error: "",
          isRunning: false,
          result: null,
          updatedAt: "",
        },
      );
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
      metadata.set("execution", {
        error: "",
        isRunning: false,
        result: null,
        updatedAt: "",
      });
      text.delete(0, text.length);
    });
  }

  async function handleRun() {
    try {
      const response = await fetch(`/sessions/${sessionId}/run`, { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Code execution failed.");
      }
    } catch (error) {
      setExecutionState({
        error: error.message,
        isRunning: false,
        result: null,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  function handleResizeStart(event) {
    event.preventDefault();

    function handlePointerMove(moveEvent) {
      const nextPercent = (moveEvent.clientX / window.innerWidth) * 100;
      setEditorWidthPercent(
        Math.min(MAX_EDITOR_PERCENT, Math.max(MIN_EDITOR_PERCENT, nextPercent)),
      );
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <main className="workspace">
      <Toolbar
        connected={connected}
        isRunning={executionState.isRunning}
        language={language}
        sessionId={sessionId}
        onLanguageChange={handleLanguageChange}
        onRun={handleRun}
      />
      {connectionError && <div className="connectionBanner">{connectionError}</div>}
      <div className="sessionBody">
        <section className="editorPane" style={{ flexBasis: `${editorWidthPercent}%` }}>
          {synced ? (
            <Editor language={language} provider={provider} ydoc={ydoc} />
          ) : (
            <div className="loadingPanel">Loading session...</div>
          )}
        </section>
        <div
          aria-label="Resize editor and execution output panels"
          className="splitter"
          onPointerDown={handleResizeStart}
          role="separator"
        />
        <ExecutionPanel executionState={executionState} />
      </div>
    </main>
  );
}

function ExecutionPanel({ executionState }) {
  const { error, isRunning, result, updatedAt } = executionState;
  const compileOutput = result?.compile?.output || "";
  const runOutput = result?.run?.output || "";
  const output = error || compileOutput || runOutput || "No output.";
  const status = error
    ? "Error"
    : isRunning
      ? "Running"
      : result
        ? `Exit ${result.run?.code ?? result.run?.signal ?? "unknown"}`
        : "";

  return (
    <section className="executionPanel">
      <div className="executionHeader">
        <span>Execution</span>
        <span>{updatedAt ? `${status} at ${new Date(updatedAt).toLocaleTimeString()}` : status}</span>
      </div>
      <pre>{output}</pre>
    </section>
  );
}

function buildUser() {
  const name = `User ${Math.floor(Math.random() * 900 + 100)}`;
  const color = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

  return { name, color };
}
