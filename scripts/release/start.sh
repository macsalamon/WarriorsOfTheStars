#!/bin/sh
# Warriors of the Stars: starts the game and opens it in your browser (Linux and macOS).
# It needs Node.js 20 or newer. It uses, in this order: the copy in the "node" folder next to this file, the Node.js installed on this computer, or it
# downloads the official Node.js into the "node" folder (about 30 MB, once; nothing is installed on your computer).
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8787}"
NODE_VERSION="@NODE_VERSION@"
NODE=""

fail() {
  echo
  echo "$1"
  echo
  exit 1
}

fetch() {
  # fetch URL FILE
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$2" "$1"
  else
    return 1
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    return 1
  fi
}

find_node() {
  if [ -x "./node/bin/node" ]; then
    NODE="$(pwd)/node/bin/node"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)"
    if [ -n "$major" ] && [ "$major" -ge 20 ] 2>/dev/null; then
      NODE="$(command -v node)"
      return 0
    fi
  fi
  return 1
}

download_node() {
  case "$(uname -s)" in
    Linux) plat=linux ;;
    Darwin) plat=darwin ;;
    *) fail "This system isn't supported by the automatic download. Install Node.js 20 or newer from https://nodejs.org and start again." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *) fail "This processor isn't supported by the automatic download. Install Node.js 20 or newer from https://nodejs.org and start again." ;;
  esac
  file="node-v$NODE_VERSION-$plat-$arch.tar.gz"
  base="https://nodejs.org/dist/v$NODE_VERSION"
  tmp="$(mktemp -d)" || fail "Could not make a temporary folder."
  echo
  echo "Node.js 20 or newer is needed to run the game, and it isn't on this computer."
  echo "It will be downloaded now from nodejs.org into the \"node\" folder here (about 30 MB)."
  echo
  fetch "$base/$file" "$tmp/$file" || { rm -rf "$tmp"; fail "Node.js could not be downloaded. Check the internet connection and start again, or install Node.js 20 or newer from https://nodejs.org."; }
  fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || { rm -rf "$tmp"; fail "The checksum of the download could not be fetched."; }
  want="$(grep " $file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  got="$(sha256 "$tmp/$file")"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    rm -rf "$tmp"
    fail "The download is damaged (the checksum doesn't match). Start again to retry."
  fi
  tar -xzf "$tmp/$file" -C "$tmp" || { rm -rf "$tmp"; fail "The download could not be unpacked."; }
  rm -rf ./node
  mv "$tmp/node-v$NODE_VERSION-$plat-$arch" ./node || { rm -rf "$tmp"; fail "Could not move Node.js into place."; }
  rm -rf "$tmp"
}

find_node || { download_node; find_node || fail "Node.js could not be set up."; }

[ -f server.cjs ] || fail "server.cjs is missing: the game wasn't unpacked completely. Unpack the whole archive, then start again."

echo
echo "Starting Warriors of the Stars on port $PORT ..."
echo "Press Ctrl+C (or close this window) to stop the game."
echo

# opens the browser as soon as the server answers (set WOTS_NO_BROWSER=1 to skip it)
if [ -z "$WOTS_NO_BROWSER" ]; then
  (
    url="http://localhost:$PORT"
    i=0
    while [ "$i" -lt 120 ]; do
      if command -v curl >/dev/null 2>&1; then
        curl -fs -o /dev/null "http://127.0.0.1:$PORT/net-info" && break
      else
        sleep 1
      fi
      i=$((i + 1))
      sleep 0.5
    done
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1
    elif command -v open >/dev/null 2>&1; then open "$url"
    elif command -v sensible-browser >/dev/null 2>&1; then sensible-browser "$url" >/dev/null 2>&1
    else echo "Open $url in your browser."
    fi
  ) &
fi

if [ -n "$WOTS_INTERNET" ]; then
  echo "The link for the other player appears below (Over the internet), and on the host screen of the game."
  exec "$NODE" server.cjs --port "$PORT" --internet
fi
exec "$NODE" server.cjs --port "$PORT"
