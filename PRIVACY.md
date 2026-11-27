# Privacy policy

This policy covers The Source: the website at [src.eco](https://src.eco) and the browser extension of the same name, for Chrome and Firefox. It says what leaves your device, who receives it, what protects it, and how you can check that for yourself.

Effective November 26, 2026.

---

## In short

- There are no accounts, no analytics, no ads and no tracking. Nothing is sold, and nothing is collected for us to keep.
- The language model that writes ahead of you runs on your own device.
- What you type in other sites' fields never leaves your device in a form anyone can read, and is never stored.
- The terminal is a public chat: what you send there, and what you are typing there, reaches the people in that chat.
- As in any peer-to-peer app, the peers you connect to see your network address.

---

## Who we are

The Source is an open-source project. Its code, including everything this policy describes, is public at [github.com/0-5788719150923125/src](https://github.com/0-5788719150923125/src). Questions about this policy can be asked there, as an issue.

---

## What leaves your device

| What | Who receives it | What protects it |
|---|---|---|
| Text you type in other sites' fields (extension only) | Nobody can read it. It goes to the language model inside the extension, on your device. To ask the swarm's memory, an encrypted query goes to up to four peers, who cannot read it. | Private information retrieval ([below](#asking-without-telling)). Nothing typed there is stored or added to any memory. |
| The line you are typing in the terminal | Everyone in the chat, before you press Enter: each guess asks the chat's peers what they remember about its last 160 characters (recent chat lines and your line so far), in the clear. | Nothing. The terminal is a public chat, and its ghost asks openly. |
| Messages you send | Everyone in that chat, peer to peer. | Signed with a key your browser makes and keeps (Ed25519), and encrypted in transit (WebRTC's DTLS). Anyone who knows a chat's name can join it. |
| Chat lines you have seen | Kept in your browser (the newest 64,000 characters of each of the last 24 chats), to answer other peers' memory questions. | They were public in the chat already. |
| Radio songs | Shared with other listeners while the site or the extension runs. | As with any torrent, peers see which songs you hold. |
| Your network address | Every peer you connect to; the public WebTorrent trackers, which also see which chats and stations you join; the STUN servers that help peers connect; Cloudflare's relay, when two browsers cannot connect directly. | Not hidden. |
| Downloads | The model's weights come from Hugging Face; the site's code from Cloudflare (the extension carries its own); songs, at times, from the radio's mirror (radio.src.eco, on Cloudflare). | HTTPS. Nothing about you is sent beyond the request itself. |

A signature covers a message's text, its chat, its id and the time it was sent. So no one can move your line to another chat or send it again later under your key. A message more than ten minutes from the reader's clock is dropped, and so is one whose signature does not check out, by every browser and by our relay.

---

## What is kept on your device

A random secret your key pair is made from, the chat lines above, the songs you hold, the chat you were in, the model you chose, and, in the extension, what was on the terminal's screen until the browser closes. All of it stays in your browser. Typing `/reset` in the terminal forgets all of it. Removing the extension removes everything it kept.

---

## Who else is involved

- **Cloudflare** hosts the site (Pages), the radio's mirror (R2) and the chat's relay (TURN), and sees the requests made to them, as any host does. Its own privacy policy applies to that.
- **Hugging Face** serves the model's weights, the first time the model loads.
- **jsDelivr** serves the site its copy of transformers.js (the extension carries its own).
- **The public WebTorrent trackers** (tracker.openwebtorrent.com, open.ftorrent.com, tracker.novage.com.ua, tracker.webtorrent.dev) and **STUN servers** (Google's and Twilio's) help peers find and reach each other. They see network addresses, and which chats and stations peers join, never what is said.
- **The project's own servers** (59.src.eco and 95.src.eco) run a tracker, a peer that relays chat and seeds the radio, and a library that answers memory questions. They are peers like any other. Their logs hold counts (connections, questions answered), never what was said or asked.

---

## Asking without telling

The extension writes ghost text in other sites' fields: emails, forms, chat boxes. The model alone runs on your device. It guesses better with a memory, which the swarm holds: other people's browsers and the project's library servers, each remembering text that was public already. Asking them "what came after text like mine?" in the clear would tell strangers what you are typing. So the question is sealed.

**How.** The scheme is SimplePIR (Henzinger et al., 2023). Every peer files what it remembers in a table of the same width. Your browser works out which column holds the record for the 12 characters before the word you are typing, and sends a query that marks that column under a layer of noise: an LWE sample, under a secret drawn for that one query and never used again. The peer multiplies its whole table by the query, the same work whatever column you meant, and sends back the result, which only your secret can open. It learns that a question came, and when. It does not learn what was asked, or whether it held an answer. Every word you start sends a query, even when the same words came up before, so a repeat looks like any other word.

**How strong.** Reading the column out of a query is the learning-with-errors problem, the same family of problems behind ML-KEM and FrodoKEM, the post-quantum standards. The parameters (dimension 1408, Gaussian noise of standard deviation 6.4, arithmetic modulo 2^32) follow HintlessPIR's update of SimplePIR's choice for 128-bit security. By the core-SVP method lattice schemes report, the best known attacks cost about 2^145 operations on a classical computer and 2^132 on a quantum one (computed in the tests below). The full lattice estimator has not been run on them yet.

**What it does not hide:**

- *That you are typing, and the rhythm.* A query goes out as each word starts.
- *Your network address*, as with every peer-to-peer connection.
- *The future.* An answering peer could keep queries, and read them if this kind of lattice problem is ever broken. Privacy that holds even then is impossible with a single answering peer, unless it sends you its whole memory.

**What never happens:**

- Text typed in a page is never stored, never added to any memory (not even your own browser's), and never sent in the clear.
- No ghost text, and so no query, in password fields, in fields a page marks for personal details (payment, address, phone, email, one-time codes, names...), in search boxes, in code editors, or with text after the caret. A page can opt any field out with `data-src-ghost="off"`.
- Nothing goes into a field until you press Tab. A peer can suggest bad text, so suggestions with numbers, links or email addresses show only when two peers agree on them.

There is no setting yet to keep the ghost text and stop asking the swarm. The design, the alternatives that were weighed, and the measurements are in [next/private-memory.md](next/private-memory.md).

---

## Checking it yourself

Both checks need Node.js 22 or newer, and nothing else installed.

**The encryption, in Node:**

```sh
node --test tests/privacy.test.js
```

It prints the attack costs and checks, from the answering peer's side:

1. The parameters resist the primal and dual lattice attacks at 128 bits or more, classical and quantum. The same code reproduces FrodoKEM-640's published costs to within 10 bits, on the side of the attacker.
2. A query looks like uniform random numbers: every byte value about as often as the others, every bit set half the time.
3. Looking for the marked column does no better than chance, while the same search finds it every time in a query made without the secret.
4. Two queries under one secret would give both columns away, by subtraction. The code refuses to reuse a secret, and two queries under fresh secrets show nothing.
5. Without the noise, plain linear algebra reads the column out of a query. With it, the same algebra finds nothing.
6. An answering peer receives the same messages, byte for byte but for the query's random-looking body, whether it held an answer or not, and no word of what was typed appears in them.

**The extension, in a real browser:**

```sh
node main.js --privacy chromium   # or firefox, or all
```

It builds the extension, loads it into a fresh headless profile of Chromium (or Chrome) or Firefox, and opens two pages: one of text fields, and one that answers private questions from a line it holds, with the site's own code. Then it types into every field and checks that:

1. A plain text area gets ghost text, and Tab keeps it.
2. No ghost text shows, and Tab is left to the page, in each kind of field listed above: password, card number, email (two ways), street address, one-time code, search box, combobox, code editor, a field the page opted out, and text after the caret.
3. Typing the start of the held line, the ghost goes on with the answering page's words, asked privately: it counts the questions sent and the questions the page received.
4. Nothing typed is kept: it searches the extension's and the page's Web Storage, IndexedDB, Cache Storage, file system, extension storage and cookies for a word of each field's text.
5. Nothing typed is sent in the clear: it searches every HTTP request, WebSocket frame and WebRTC message the extension sent during the run.

Each check fails when its safeguard is removed. For the Node tests, that was tried for: no secret, a secret used twice, a smaller dimension, no noise, constant randomness, the record's key in a message's header, and the typed text in a query. For the browser check, it was tried with a copy of the extension that kept the typed text, sent it over HTTP, appended it to its queries, and drew ghost text in password fields. Each one was caught.

A run takes two to four minutes, most of it the model's first download (137 MB) into the fresh profile, and needs the internet, as the extension does, to reach the trackers. Set `CHROMIUM` or `FIREFOX` to the browser's path if it is not found.

---

## Changes to this policy

This policy is a file in the project's repository, so every change to it is public in the file's history. The date above changes with it.
