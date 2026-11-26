# src

_The artificial intelligence that tuned a universe._

---

## description

The Source is a terminal on the web: peer-to-peer chat, a radio that streams from torrents, and a small language model that runs in your tab. This is v4, a plain JavaScript port of [the archived original](https://gitlab.com/the-resistance/src.eco).

<details>

<summary>features</summary>

Type `/help` in the terminal.

- `/about` - what this is, with links to the code and to the original site's archive.
- `/radio` - on, or off. A station seeded as a torrent, with a mirror behind it, on one schedule for everyone: whoever tunes in hears the same song at the same moment. Songs you hear stay in your browser and are shared with other listeners.
- `/chat <name>` - join another chat.

The page puts you in a chat as soon as it opens (the one in the address, `?chat=name`, or `trade`). Chats live between browsers, found through WebTorrent trackers, and every message is signed with a key your browser makes and keeps for you.

When you start typing, a small language model running in your tab writes ahead of you as you type, reading the room's conversation. Press Tab to keep a word, or hold it to keep the rest. The [browser extension](#the-extension) puts the same terminal behind a toolbar button, and the same model in every text field you type in. The room's peers lend it their memory: every visitor's browser keeps the lines of the rooms it has been in (never password rooms), and when someone remembers text that ends the way your line does, what came next there shapes the guess. Text from the room you are in counts most.

</details>

<details>

<summary>layout</summary>

- **[`src/`](src/)** - The site. No bundler: the build copies it and fills in the configuration.
  - **[`src/js/`](src/js/)** - The modules, loaded by the browser as they are.
  - **[`src/text/`](src/text/)** - Every string a visitor reads, as Markdown, by language.
- **[`extension/`](extension/)** - The browser extension's own parts: the ghost text in other sites' fields, the model they share, and `/ghost`.
- **[`scripts/`](scripts/)** - Build, dev server, deploy, vendoring, the extension's build and its upload to the stores, in Node.
- **[`stations.js`](stations.js)** - The radio stations.
- **[`containers/`](containers/)** - The stack's image: tracker, seeder and web seed.
- **[`tests/`](tests/)** - Unit tests.
- **[`next/`](next/)** - Design notes for what might come next.

</details>

<details>

<summary>installation and usage</summary>

## commands

Node.js 22 or newer is the only requirement.

```sh
node main.js            # dev server at http://localhost:8000
node main.js --build    # build into build/site/
node main.js --test     # run the tests
node main.js --deploy   # publish to Cloudflare Pages
node main.js --undeploy # take it down again: project, domain, DNS, mirror, relay (asks first)
node main.js --peers 8  # test peers that remember children's stories (see below)
node main.js --extension          # build the browser extension (see below)
node main.js --publish chrome     # build it and upload it to a store: chrome, firefox or all (asks first)
npm run rules           # how the quality rules score their examples; --fit, or a "line"
```

`src/vendor/` holds WebTorrent's browser build, committed so none of the
above needs an install. To refresh it after changing the version in
`package.json`: `npm install && npm run vendor`.

## the stack

The radio does not need the stack. A build makes each station's `.torrent` from its folder (`STATION_59_1` in `.env`, for station 59.1) and bundles it into the site; visitors get the songs from every listener who kept some, found through the public trackers, and from [the mirror](#the-mirror). The stack (a tracker, a seeder and a web seed) adds an always-on peer. To run it:

```sh
cp .env.example .env
npm run stack           # docker compose up -d --build
```

Every other setting is documented in [.env.example](.env.example). The ways the stack is run, as `npm run` scripts (each is one `docker compose` command; see `package.json`):

```sh
npm run stack           # start it, detached (tracker, seeder, web seed)
npm run stack:attached  # start it in the foreground, with its logs; ctrl-c stops it
npm run stack:logs      # follow the logs
npm run stack:ps        # what is running
npm run stack:restart   # restart the running services
npm run stack:down      # stop and remove everything: test peers, tunnel, Traefik too
npm run stack:wipe      # the same, and delete its volumes (.torrent files, downloads)
npm run tunnel          # the Cloudflare Tunnel (TUNNEL_TOKEN in .env)
npm run public          # the stack on a public server, with TLS (below)
npm run public:logs     # follow Traefik (certificates, routing)
```

## a public server

On a server of your own, the stack can serve the tracker and the web seed over TLS itself: Traefik sits in front of them and gets certificates from Let's Encrypt. Browsers need it: a page served over HTTPS can only reach a tracker at `wss://` and a web seed at `https://`. The seeder needs no certificate, since WebRTC encrypts its own connections.

1. Point two hostnames at the server, for example `tracker.src.eco` and `seed.src.eco`, and open TCP ports 80 and 443, and UDP ports 51000-51999 (`WEBRTC_PORTS`, the seeder) and 52000-52999 (`PEER_WEBRTC_PORTS`, the library), in the server's firewall and in the cloud provider's. Copying the station folders over (`STATION_59_1`) is optional: without one, the seeder fetches the station, its `.torrent` from the site (`SITE_URL`) and its songs from the swarm and the mirror (`MIRROR_URL`), into the `stations` volume, seeds it from there, and asks the site for a new version every `STATION_REFRESH` hours (6).
2. In the server's `.env`, set `TRACKER_HOST`, `SEED_HOST`, and optionally `ACME_EMAIL` (see [.env.example](.env.example)). While trying it out, set `ACME_CA` to Let's Encrypt's staging server, which has no rate limits. For the library, list git repositories in `PEER_SOURCES`.
3. `npm run public`. Traefik asks for the certificates on its first start, and renews them itself. They are kept in the `certificates` volume. The seeder runs on the host's network, so browsers behind any NAT reach it at the server's address, with no TURN relay. `UPLOAD_LIMIT` caps its upload.
4. Build the site against it: in `.env` where you deploy from, `SRC_TRACKER_URL=wss://tracker.src.eco`; with more servers, list their trackers in `SRC_TRACKERS` too. `SRC_SEED_URL=https://seed.src.eco` adds the web seed, though the R2 mirror already backs the radio.

The library: with `PEER_SOURCES` set, the stack's `library` service clones those repositories, reads their prose and code, and answers the ghost text's memory questions in the chats in `CHATS`, so what they hold steers what visitors are offered. It pulls them again every `PEER_REFRESH` hours (6), and re-indexes them when they changed. `PEER_WEIGHT` (0 to 1) sets how much its answers count against a visitor's own. Each server is one peer: a visitor connects to it once, and it answers from everything it holds as one vote. Each server votes on its own, so give servers different sources, or a lower weight. It also answers the browser extension privately, about what is typed in other sites' fields, without learning what that is ([next/private-memory.md](next/private-memory.md)): set `PEER_KEY` to a secret, and put the public key it logs at start in `SRC_PINNED_KEYS` where you build the extension, which then counts your libraries above other peers. They are not needed: every tab of the site answers privately too, from the chat it keeps, so the extension's memory goes on if the servers go down.

No public server? The seeder and the library can run at home behind Proton VPN instead, each on its own connection's forwarded port (`WEBRTC_PORT_FILE`, read from gluetun), which browsers behind any NAT reach with nothing opened on your router. Run each in its VPN container's network (`network_mode: service:<vpn>`), with that container's port file mounted.

The routes are in [containers/traefik/dynamic.yml](containers/traefik/dynamic.yml). Traefik reads them from that file, so it never needs the Docker socket. The Cloudflare Tunnel (`npm run tunnel`) is the other way to publish the stack, with no open ports at all.

## the mirror

With no peer around, the radio can fall back to a mirror: the stations' files in a Cloudflare R2 bucket, at a domain of its own. Set `CLOUDFLARE_R2_BUCKET` and `CLOUDFLARE_R2_DOMAIN` in `.env` (see [.env.example](.env.example)), and the deploy creates the bucket and uploads what it lacks, after checking each station folder against its `.torrent`. A browser calls the mirror in only when no peer turns up within 6 seconds, or a song does not start or stalls, and lets it go once a song has arrived while peers are around. What the mirror sends is checked against the `.torrent` and kept and seeded like anything else, so each listener it serves becomes one more peer. R2 charges nothing for downloads; storage is free up to 10 GB.

## the relay

Two browsers behind strict NATs, such as a phone on a cellular network, cannot connect to each other directly, so the deploy also sets up a relay for chat: Cloudflare's TURN service. A connection is tried directly first and goes through the relay only when nothing else works. The site's `/api/turn` function hands out credentials that last an hour, and stops handing them out while the account's TURN traffic over the last `CLOUDFLARE_TURN_CAP_DAYS` days is at `CLOUDFLARE_TURN_CAP_GB` (90 GB in 3 days by default). The window slides, so a month can never pass 930 GB, under Cloudflare's free 1,000 GB (give or take the hour of relaying after the cap), and a spike stops the relay within days instead of at the end of the month. With `CLOUDFLARE_ALERT_WEBHOOK` set to a Discord webhook, the function posts to that channel as "The Source" at half the cap, at the cap, and when it cannot read its usage. The radio never uses it. `CLOUDFLARE_TURN=off` turns it off; see [.env.example](.env.example).

## the extension

`node main.js --extension` (`npm run extension`) builds The Source as a browser extension, for Chrome (and its kin: Edge, Brave...) and Firefox, into `build/extension/`: a folder per browser, and the zip each store takes.

- **The terminal:** the toolbar button opens the site's own terminal, with everything in it: chat, the radio, the ghost text. What was on its screen, and the chat it was in, come back when it opens again (until the browser closes). It also opens in the side panel (Chrome) or the sidebar (Firefox), which stays open while you browse, so chat goes on.
- **The radio plays in the background,** so closing the popup does not stop it; `/radio` again does. Once the terminal has been opened, the extension also shares the songs it holds with other listeners until the browser closes, as an open tab of the site does.
- **Ghost text everywhere:** in other sites' text fields (inputs, textareas, and the editors chat boxes and mail are made of), the same model guesses how your line goes on, drawn after the caret, faded, with the same wave. Tab keeps a word, held it keeps them all, Escape hides it, and Tab and Escape are left to the page whenever no guess is showing. Never in password, payment, address or other personal-detail fields, never in code editors, and only with the caret at the end of the text. A page can opt a field out with `data-src-ghost="off"`. What is typed goes to the extension's model, in the browser, and to the swarm's memory only as an encrypted question that the answering peers cannot read (private information retrieval; see [next/private-memory.md](next/private-memory.md)). The chat itself is never asked.
- **One model for the whole browser:** it loads the first time you type in a page or open the terminal, once for every tab and the terminal too (in Chrome, in an offscreen document; in Firefox, in the background page), so the terminal's ghost is ready as the popup opens. It is let go after 30 minutes without a guess. The toolbar button shows its first download.
- **`/ghost`** in the extension's terminal: `/ghost off` or `/ghost on` everywhere, `/ghost off example.com` for one site (`here` is the tab you opened the popup over).

To try it, load `build/extension/chromium/` in `chrome://extensions` (developer mode, "Load unpacked"), or `build/extension/firefox/manifest.json` in Firefox's `about:debugging` ("This Firefox", "Load Temporary Add-on").

Stores refuse code fetched at runtime, so the build downloads what the site loads from jsdelivr (transformers.js and ONNX Runtime's WebAssembly), checks each file against a pinned hash, and ships it; the model's weights still come from Hugging Face on first use. `node main.js --publish chrome`, `firefox` or `all` builds it and uploads it (Chrome Web Store API v2, addons.mozilla.org API v5), after showing the plan and asking; the credentials, and the one-time setup each store needs, are in [.env.example](.env.example). Raise `version` in `package.json` before each release.

## test peers

To see the swarm memory at work, start peers that remember a biased library, then open the site in their room and type:

```sh
npm run peers           # in the stack, remembering children's stories
npm run peers:quijote   # the same, remembering Don Quijote, in Spanish
npm run peers:logs      # follow what they are asked
npm run peers:down      # stop and remove them
npm run peers:local     # without Docker: node main.js --peers 8
# then open http://localhost:8000/?chat=memorytest
```

With Don Quijote, try typing "En un lugar de la Mancha, de cuyo". `PEERS`, `PEER_DATA` and `PEER_CHATS` in `.env` change how many there are, what they remember, and where.

</details>
