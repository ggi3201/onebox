#!/bin/sh
# scripts/metro-port.sh: one Metro port per app and per worktree.
# Main checkout: 8200-8299, from the repo's folder name, so two apps' main
# checkouts do not share 8081. Worktrees: 8100-8199, from the worktree path.
root=$(git rev-parse --show-toplevel)
if [ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
  basename "$root" | cksum | awk '{print 8200 + ($1 % 100)}'
else
  printf '%s' "$root" | cksum | awk '{print 8100 + ($1 % 100)}'
fi
