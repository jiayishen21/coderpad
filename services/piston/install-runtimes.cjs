const http = require("http");

const PISTON_HOST = "127.0.0.1";
const PISTON_PORT = Number(process.env.PORT || 2000);

const RUNTIMES = [
  { language: "python", version: "3.x", aliases: ["python", "py"] },
  { language: "node", version: "*", aliases: ["javascript", "js", "node"] },
  { language: "typescript", version: "*", aliases: ["typescript", "ts"] },
];

async function main() {
  const installedRuntimes = await getInstalledRuntimes();

  for (const runtime of RUNTIMES) {
    if (isRuntimeInstalled(installedRuntimes, runtime.aliases)) {
      console.log(`${runtime.language} already installed`);
      continue;
    }

    console.log(`Installing ${runtime.language} ${runtime.version}`);
    const response = await requestJson("/api/v2/packages", {
      method: "POST",
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
      }),
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Failed to install ${runtime.language}: ${response.body.message || response.statusMessage}`,
      );
    }

    console.log(`Installed ${response.body.language} ${response.body.version}`);
  }
}

async function getInstalledRuntimes() {
  const response = await requestJson("/api/v2/runtimes");

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Piston API not ready: ${response.statusCode}`);
  }

  return response.body;
}

function isRuntimeInstalled(installedRuntimes, aliases) {
  return installedRuntimes.some((runtime) => {
    const runtimeNames = [runtime.language, ...(runtime.aliases || [])];
    return aliases.some((alias) => runtimeNames.includes(alias));
  });
}

function requestJson(path, options = {}) {
  const body = options.body || "";

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: PISTON_HOST,
        port: PISTON_PORT,
        path,
        method: options.method || "GET",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let rawBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          rawBody += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode,
              statusMessage: response.statusMessage,
              body: rawBody ? JSON.parse(rawBody) : {},
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
