WARRIORS OF THE STARS  @VERSION@  (@SYSTEM@)
A starfighter combat game for your browser, against the computer or over the network.

HOW TO START
  Unpack the whole archive somewhere (any folder you can write to), then run @START@.
  The game starts a small server on this computer and opens it in your browser (http://localhost:8787).
  Leave the window open while you play: closing it stops the game.

  The game needs Node.js 20 or newer. @START@ uses the one in the "node" folder next to it, or the one installed on this computer, or
  downloads the official Node.js (from nodejs.org, checked against its published checksum) into the "node" folder, once. Nothing is installed on
  your computer and nothing is changed outside this folder.

PLAYING
  Against the computer: choose a scenario and a side in the menu, press Start game.
  Over the network: one player picks "Host a network game" in the menu. The window prints the address for the other player (for example
  http://192.168.1.20:8787), who opens it in a browser and picks "Join a network game". Your system may ask once whether to let the program
  accept connections on the private network: allow it.
  Over the internet: run @NETSTART@ instead of @START@ (the first time it needs the free program "cloudflared"; @NETHELP@). It opens a
  tunnel and prints a link such as https://some-words.trycloudflare.com/?join; the host screen of the game shows the same link with a Copy
  button. Send it to the other player by mail or chat: it opens the game on its joining screen. The link is new every time and works for
  as long as the window is open. No router settings and no account are needed.
  The board can be shown in 3D (the "3D" switch over the board): drag to move the map, right mouse button to turn and tilt, wheel to zoom.
  Browser: the game runs best in Chrome, Edge or another Chromium-based browser. In Firefox the 3D view is jerky; use the flat view there, or another browser.
  Keys for the ship you are moving: W A D (or the arrows), Q E, S, F, Backspace, Delete. Hover "Keys" in the bar for the list.
  How the game works: RULES.md.

YOUR FILES
  saves/       saved games (the Save button, and an autosave); the menu lists them
  scenarios/   scenarios of your own, as .json files (see example-duel.json); they appear under "Your scenarios"

OTHER PORT
  If the port 8787 is in use, start the game from a terminal in this folder with another port:  PORT=9000 (Linux, macOS)  or  set PORT=9000 (Windows).

CREDITS
  See CREDITS.md and the Credits page of the menu. A special thank you to the Fate of the Galaxy team, whose models make the ships.
  This is an unofficial, non-commercial fan project. It is not affiliated with or endorsed by Lucasfilm or Disney.
