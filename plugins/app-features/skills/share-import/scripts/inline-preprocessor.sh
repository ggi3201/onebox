#!/usr/bin/env bash
# Print share-preprocessor.js as one JSON string, ready to paste as the value
# of "preprocessorInjectJS" in app.json. Comments are removed.
#
#   inline-preprocessor.sh [path/to/share-preprocessor.js]
set -euo pipefail
src="${1:-$(dirname "$0")/../assets/mobile/share-preprocessor.js}"
node -e '
  const fs = require("fs");
  const code = fs.readFileSync(process.argv[1], "utf8")
    .split("\n")
    .map((l, i) => {
      const line = l.replace(/^\s*\/\/.*$/, "").trim();
      // Lines are joined with spaces, so a comment after code would swallow the rest.
      if (/(^|[^:])\/\/\s/.test(line)) throw new Error(`line ${i + 1}: move the trailing // comment to its own line`);
      return line;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\/\*.*?\*\//g, "");
  new Function("metas", "document", code); // throws if the result is not valid JS
  process.stdout.write(JSON.stringify(code) + "\n");
' "$src"
