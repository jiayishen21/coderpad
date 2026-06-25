import { useEffect, useState } from "react";
import SessionLoader from "./components/SessionLoader.jsx";

export default function App() {
  const [sessionId, setSessionId] = useState(getSessionIdFromPath);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handleNavigation() {
      setSessionId(getSessionIdFromPath());
    }

    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  async function createSession() {
    setIsCreating(true);
    setError("");

    try {
      const response = await fetch("/sessions", { method: "POST" });

      if (!response.ok) {
        throw new Error("Unable to create a new session.");
      }

      const session = await response.json();
      window.history.pushState(null, "", session.url);
      setSessionId(session.sessionId);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  }

  if (!sessionId) {
    return (
      <main className="home">
        <section className="hero">
          <p className="eyebrow">Collaborative interviews</p>
          <h1>Start a shared coding session in one click.</h1>
          <p className="subtitle">
            Share the link, edit together in Monaco, and keep the session state
            after refreshes.
          </p>
          <button className="primaryButton" disabled={isCreating} onClick={createSession}>
            {isCreating ? "Creating..." : "Create session"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return <SessionLoader sessionId={sessionId} />;
}

function getSessionIdFromPath() {
  const match = window.location.pathname.match(/^\/session\/([^/]+)$/);
  return match?.[1] ?? "";
}
