const PISTON_URL = `http://127.0.0.1:${process.env.PORT || 2000}`;

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
    const response = await fetch(`${PISTON_URL}/api/v2/packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        `Failed to install ${runtime.language}: ${body.message || response.statusText}`,
      );
    }

    console.log(`Installed ${body.language} ${body.version}`);
  }
}

async function getInstalledRuntimes() {
  const response = await fetch(`${PISTON_URL}/api/v2/runtimes`);

  if (!response.ok) {
    throw new Error(`Piston API not ready: ${response.status}`);
  }

  return response.json();
}

function isRuntimeInstalled(installedRuntimes, aliases) {
  return installedRuntimes.some((runtime) => {
    const runtimeNames = [runtime.language, ...(runtime.aliases || [])];
    return aliases.some((alias) => runtimeNames.includes(alias));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
