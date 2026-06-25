const PISTON_URL = process.env.PISTON_URL || "http://localhost:2000";
const MAX_SOURCE_BYTES = Number(process.env.EXECUTION_MAX_SOURCE_BYTES || 64 * 1024);
const RUN_TIMEOUT_MS = Number(process.env.EXECUTION_RUN_TIMEOUT_MS || 3000);
const COMPILE_TIMEOUT_MS = Number(process.env.EXECUTION_COMPILE_TIMEOUT_MS || 5000);
const RUN_MEMORY_LIMIT_BYTES = Number(
  process.env.EXECUTION_RUN_MEMORY_LIMIT_BYTES || 128 * 1024 * 1024,
);
const COMPILE_MEMORY_LIMIT_BYTES = Number(
  process.env.EXECUTION_COMPILE_MEMORY_LIMIT_BYTES || 256 * 1024 * 1024,
);

const LANGUAGE_CONFIG = {
  javascript: {
    pistonLanguage: "javascript",
    version: "*",
    filename: "main.js",
  },
  typescript: {
    pistonLanguage: "typescript",
    version: "*",
    filename: "main.ts",
  },
  python: {
    pistonLanguage: "python",
    version: "3.x",
    filename: "main.py",
  },
};

async function executeCode({ code, language }) {
  const config = LANGUAGE_CONFIG[language];

  if (!config) {
    const supportedLanguages = Object.keys(LANGUAGE_CONFIG).join(", ");
    const error = new Error(`Unsupported language "${language}". Supported: ${supportedLanguages}.`);
    error.statusCode = 400;
    throw error;
  }

  if (Buffer.byteLength(code, "utf8") > MAX_SOURCE_BYTES) {
    const error = new Error(`Source is too large. Max size is ${MAX_SOURCE_BYTES} bytes.`);
    error.statusCode = 413;
    throw error;
  }

  const startedAt = Date.now();
  const response = await fetch(`${PISTON_URL}/api/v2/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      language: config.pistonLanguage,
      version: config.version,
      files: [{ name: config.filename, content: code }],
      stdin: "",
      args: [],
      run_timeout: RUN_TIMEOUT_MS,
      compile_timeout: COMPILE_TIMEOUT_MS,
      run_cpu_time: RUN_TIMEOUT_MS,
      compile_cpu_time: COMPILE_TIMEOUT_MS,
      run_memory_limit: RUN_MEMORY_LIMIT_BYTES,
      compile_memory_limit: COMPILE_MEMORY_LIMIT_BYTES,
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.message || "Code execution failed.");
    error.statusCode = response.status;
    throw error;
  }

  return normalizePistonResponse(body, Date.now() - startedAt);
}

function normalizePistonResponse(body, elapsedMs) {
  return {
    language: body.language,
    version: body.version,
    elapsedMs,
    compile: body.compile ? normalizeStage(body.compile) : null,
    run: normalizeStage(body.run),
  };
}

function normalizeStage(stage = {}) {
  return {
    stdout: stage.stdout || "",
    stderr: stage.stderr || "",
    output: stage.output || "",
    code: stage.code ?? null,
    signal: stage.signal ?? null,
    message: stage.message || null,
    status: stage.status || null,
    wallTime: stage.wall_time ?? null,
    cpuTime: stage.cpu_time ?? null,
    memory: stage.memory ?? null,
  };
}

module.exports = {
  executeCode,
};
