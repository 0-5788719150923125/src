# src

_The artificial intelligence that tuned a universe._

---

## description

The Source is a terminal on the web: peer-to-peer chat, a radio that streams from torrents, and a small language model that runs in your tab. This is v4, a plain JavaScript port of [the archived original](https://gitlab.com/the-resistance/src.eco).

<details>

<summary>features</summary>

Type `/help` in the terminal.

- `/about` - the lore.
- `/radio` - stations seeded as torrents, with a web seed behind them. Songs you hear stay in your browser and are shared with other listeners.
- `/connect` - chat rooms that live between browsers, found through WebTorrent trackers.
- `/focus` - change rooms, optionally with a shared password.
- `/id` - sign your messages.
- `/call` - ask PEN@ROOT, a language model in your tab, to speak.
- `/decrypt` - read a message that was encrypted offline.

</details>

<details>

<summary>layout</summary>

- **[`src/`](src/)** - The site. No bundler: the build copies it and fills in the configuration.
  - **[`src/js/`](src/js/)** - The modules, loaded by the browser as they are.
  - **[`src/text/`](src/text/)** - Every string a visitor reads, as Markdown, by language.
- **[`scripts/`](scripts/)** - Build, dev server, deploy and vendoring, in Node.
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
```

`src/vendor/` holds WebTorrent's browser build, committed so none of the
above needs an install. To refresh it after changing the version in
`package.json`: `npm install && npm run vendor`.

## the stack

The radio needs the stack: a tracker, a seeder and a web seed. Set `STATION_59` to the station's folder, then:

```sh
cp .env.example .env
docker compose up -d --build
```

Every other setting is documented in [.env.example](.env.example).

</details>
