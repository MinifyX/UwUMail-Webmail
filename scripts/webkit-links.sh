#!/usr/bin/env bash
# Builds the demo and runs scripts/webkit-links.mjs against it in the Playwright image (see there).
# Screenshots of a failure land in .webkit-links/.
set -euo pipefail
cd "$(dirname "$0")/.."
version=1.63.0
out=.webkit-links
VITE_DEMO=1 pnpm exec vite build --outDir "$out/dist" --emptyOutDir >/dev/null
docker run --rm -v uwumail-playwright:/pw -v "$PWD:/w:ro" -v "$PWD/$out:/out" \
  "mcr.microsoft.com/playwright:v$version-noble" bash -c "
    [ -d /pw/node_modules/playwright ] || npm i --prefix /pw --no-save --silent playwright@$version >/dev/null
    mkdir -p /run/links && cd /run/links && ln -s /pw/node_modules node_modules && cp /w/scripts/webkit-links.mjs .
    status=0; node webkit-links.mjs /out/dist || status=\$?
    for f in *.png; do [ -e \"\$f\" ] && cp \"\$f\" /out/ && chown $(id -u):$(id -g) \"/out/\$f\"; done
    exit \$status"
