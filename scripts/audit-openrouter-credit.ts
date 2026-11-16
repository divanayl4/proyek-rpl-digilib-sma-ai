import { readActiveConfig, readActiveApiKeyForProvider } from "../src/lib/ai/configStore";

async function main() {
  const active = await readActiveConfig();
  if (!active) {
    console.log("no active config");
    return;
  }
  const key = await readActiveApiKeyForProvider(active.provider);
  if (!key) {
    console.log("no key");
    return;
  }
  if (active.provider !== "OPENROUTER") {
    console.log("active provider not OPENROUTER:", active.provider);
    return;
  }
  const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log("status", res.status);
  console.log(await res.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
