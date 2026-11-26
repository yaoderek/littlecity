#!/bin/sh
# Publish the forwarding page (tools/bridge) at the old address,
# https://yaoderek.github.io/littlecity/ (this repo's gh-pages branch), as
# index.html and 404.html, so the address and every old path forward to
# https://littlecity.io/ bringing each player's towns along (see the page's
# own comment). Run from the repo root; needed only when tools/bridge changes.
#
# Nothing is taken away: the last game build stays on the branch beside the
# page, so a game already open at the old address keeps loading what it asks
# for (code split off, pictures, sounds) and keeps saving until it is closed;
# its newer towns come along on the next visit.
set -e
ROOT=$(pwd)
OUT="$ROOT/.context/bridge-dist"
SHA=$(git rev-parse --short HEAD)
REMOTE=$(git remote get-url origin)
rm -rf "$OUT"
git clone -q --depth 1 --branch gh-pages "$REMOTE" "$OUT"
cp tools/bridge/index.html "$OUT/index.html"
cp tools/bridge/index.html "$OUT/404.html"
cd "$OUT"
git add -A
git commit -q -m "The old address forwards to littlecity.io, bringing towns along (from $SHA)

The last game build stays beside the page, for games still open here."
git push -q "$REMOTE" gh-pages
gh api -X POST repos/yaoderek/littlecity/pages/builds >/dev/null 2>&1 || true
echo "published the forwarding page from $SHA to https://yaoderek.github.io/littlecity/"
