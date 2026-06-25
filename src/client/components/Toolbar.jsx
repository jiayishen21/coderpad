const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "markdown",
];

export default function Toolbar({ connected, language, sessionId, onLanguageChange }) {
  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
  }

  return (
    <header className="toolbar">
      <div>
        <span className="brand">CoderPad Clone</span>
        <span className="sessionId">Session {sessionId}</span>
      </div>
      <div className="toolbarControls">
        <span className={connected ? "status connected" : "status"}>
          {connected ? "Connected" : "Connecting"}
        </span>
        <label>
          Language
          <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
            {LANGUAGES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <button className="secondaryButton" onClick={copyLink}>
          Copy link
        </button>
      </div>
    </header>
  );
}
