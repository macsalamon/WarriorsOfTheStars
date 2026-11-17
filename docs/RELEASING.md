# Building the playable packages

`npm run release` (or `node scripts/build-release.mjs [--version 1.0.0] [--skip-build]`) builds the downloads in `release/` (git-ignored):

| File | For |
| --- | --- |
| `warriors-of-the-stars-<version>-windows.zip` | Windows: `start.bat` downloads Node.js into `node/` when the computer has none |
| `...-windows-with-node.zip` | Windows, with `node.exe` inside: nothing to download, a bigger file (about 45 MB) |
| `...-linux.tar.gz` | Linux: `start.sh` |
| `...-macos.tar.gz` | macOS: `start.command` (double-click) or `start.sh` |
| `SHA256SUMS.txt` | the checksums of the four files |

Every package holds the built page (`dist/`), the server as one file (`server.cjs`: `server/main.ts` bundled with `ws` by esbuild, for Node 20 or newer), `scenarios/example-duel.json`, `RULES.md`, `CREDITS.md` and `README-PLAY.txt`. The player needs no `npm install`.

## The start scripts (`scripts/release/`)

They look for Node.js 20 or newer in this order: the `node/` folder next to the script, the Node.js on the PATH, and if there is none they download the official build (`NODE_VERSION` in `build-release.mjs`, now 22.21.0) from nodejs.org into `node/`, **checked against the SHA-256 that nodejs.org publishes** (`get-node.ps1` on Windows, `start.sh` elsewhere: Linux x64, arm64 and armv7l, macOS x64 and arm64). Nothing is installed on the player's computer. They then start `server.cjs` and open the default browser when the server answers (set `WOTS_NO_BROWSER=1` to skip that, `PORT=9000` for another port; the default is 8787). `start.bat` is written with Windows line endings and the shell scripts with Unix ones by the build, whatever the files in the repository have.

The `.tar.gz` archives are written by a small tar writer in the build script, so that `start.sh` and `start.command` keep their executable bits when the packages are built on Windows.

## Trying a package locally

Unpack a package from `release/` into a folder of its own (`release/try/windows/` and `release/try/windows-with-node/` were made that way) and double-click `start.bat`: the browser opens by itself. The plain `windows` package uses the Node.js that is installed on the computer, so it does not show the download; the `windows-with-node` package uses its own `node.exe`. To see the download, run the plain package on a computer without Node.js, or with Node.js off the PATH. The server answers on `http://localhost:8787`; closing the window stops it.

The readiness check that opens the browser asks `127.0.0.1`, not `localhost`: Windows PowerShell 5 may try the IPv6 address first and wait for it, so the browser never opened in a test with `localhost`.

## What was tested (2026-11-12)

On Windows 11: the build; the `windows-with-node` package started from an unpacked copy (it uses its own `node.exe` and serves the page, an image and the file API); the plain `windows` package with no Node on the PATH (it downloads, checks and unpacks Node.js, then starts). The shell scripts passed `bash -n` and were read through; **they have not been run on Linux or macOS**: try them on a real machine before a release.

## Public downloads

The credits (`CREDITS.md`, also in every package) and the permission of the Fate of the Galaxy team cover a public download. The packages are built with `npm run release`; attach them to a release of the repository.
