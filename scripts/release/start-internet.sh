#!/bin/sh
# Warriors of the Stars: starts the game with a tunnel to the internet, so that a player anywhere can join with a link.
cd "$(dirname "$0")" || exit 1
if ! command -v cloudflared >/dev/null 2>&1; then
  echo
  echo "The tunnel needs the free program cloudflared, which is not installed yet."
  echo "  macOS:  brew install cloudflared"
  echo "  Linux:  see https://github.com/cloudflare/cloudflared/releases (or your package manager)"
  echo "Install it, then start this again."
  exit 1
fi
WOTS_INTERNET=1 exec sh ./start.sh
