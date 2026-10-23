const fs = require("fs");
const path = require("path");
const { createMaterialCenter } = require("./material-center.js");

async function main() {
  const appRoot = path.resolve(__dirname, "..", "..");
  const packageRoot = path.resolve(appRoot, "..");
  const libraryPath = process.env.AI_REMIX_LIBRARY
    || "H:\\codex输出\\AI智能混剪\\library.json";
  const library = JSON.parse(fs.readFileSync(libraryPath, "utf8").replace(/^\uFEFF/, ""));
  const materialCenter = createMaterialCenter({
    appRoot,
    packageRoot,
    ffprobe: process.env.FFPROBE_PATH || "ffprobe"
  });
  const status = await materialCenter.init();
  if (!status.connected) throw new Error(status.error || status.message);
  const result = await materialCenter.syncRemixLibrary(library, "system-migration-v2.6.2");
  const summary = await materialCenter.getSummary();
  console.log(JSON.stringify({ ok: true, result, summary }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
