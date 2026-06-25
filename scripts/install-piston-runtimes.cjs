const PISTON_URL = process.env.PISTON_URL || "http://localhost:2000";

const RUNTIMES = [
  { language: "python", version: "3.x" },
  { language: "node", version: "*" },
  { language: "typescript", version: "*" },
];

async function main() {
  for (const runtime of RUNTIMES) {
    process.stdout.write(`Installing ${runtime.language} ${runtime.version}... `);

    const response = await fetch(`${PISTON_URL}/api/v2/packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runtime),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        `Failed to install ${runtime.language}: ${body.message || response.statusText}`,
      );
    }

    console.log(`${body.language} ${body.version}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
