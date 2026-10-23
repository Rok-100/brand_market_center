"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function containsFile(root, file) {
  const relative = path.relative(root, file);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function resolveServedMediaPath(candidate, roots) {
  const requested = String(candidate || "").trim();
  if (!requested || !path.isAbsolute(requested) || requested.includes("\0")) return null;
  let realFile;
  try {
    realFile = await fs.realpath(requested);
    if (!(await fs.stat(realFile)).isFile()) return null;
  } catch {
    return null;
  }
  for (const root of roots) {
    if (!root) continue;
    try {
      const realRoot = await fs.realpath(root);
      if (containsFile(realRoot, realFile)) return realFile;
    } catch {
      // Optional product directories can be absent on another workstation.
    }
  }
  return null;
}

module.exports = { resolveServedMediaPath };
