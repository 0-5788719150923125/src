# Private memory: asking the swarm without showing it the question

> Status: **built end to end, not deployed** (2026-11-25/26). The
> extension's page-field ghost asks the swarm privately, and anyone can
> answer: the library servers, every tab of the site, and every
> extension's background, so nothing hangs on a server. Checked locally in
> Chromium and Firefox. The servers run the old image until the user
> rebuilds them; the parameters are not yet checked with the lattice
> estimator. A work in progress, to be refined.

## The problem

The extension writes ghost text in other sites' fields. The swarm memory
(`memory.js`, `recall.js`) makes the ghost far better, but a memory
question carries its context in the clear to every peer in the chat:
anyone, since joining is free. Fine for the terminal's chat (no expectation
of privacy there; the user's call), not for an email draft. So page-field
questions hide their text from the peers that answer them.

## Why private information retrieval

Researched 2026-11-25 (the report was not kept). In short:

- **Onion routing, mixnets, relays** hide who asked, never what: the
  answering peer reads the context, a draft names its author, and
  successive questions overlap almost entirely, so a session chains back
  into the whole draft. Useful later on top, to hide the IP address and
  timing, which retrieval does not.
- **Hash prefixes, decoys, local differential privacy** leak here: a
  simulation recovered every test text exactly from 16-bit hashes of
  overlapping windows. **A classifier** of sensitive text would have to be
  nearly perfect, every miss being a permanent disclosure.
- **Two-server retrieval** needs identical copies at parties that do not
  collude; tabs hold different data.
- **Downloading peers' memories** was ruled out (the user's call): its
  bandwidth grows with users and stored text.
- **Single-server LWE retrieval** hides the question completely under a
  standard lattice assumption, and at a peer's size the plainest scheme is
  cheap: SimplePIR (Henzinger et al., 2023) in FrodoPIR's layout. Newer
  schemes (YPIR, InsPIRe, HintlessPIR, Spiral) pay 40-700 ms or 80 KB-8 MB
  of keys per lookup at this size.

Retrieval protects asking only. Anything a peer stores, any asker can read,
so page text is never added to any memory: it only asks.

## What was built

- **`src/js/pir.js`**, the retrieval: plain LWE modulo 2^32, all 32-bit
  integer arithmetic in JavaScript (`Math.imul`), no library, no WASM. A
  table is records of 256 bytes in 2^14 columns, stacked in groups; a query
  selects a column (a mask under a fresh secret, used once), the peer
  multiplies its whole table by it, the asker decrypts its record with the
  peer's hint (the table times the public matrix A). A is the AES-128-CTR
  stream of a fixed seed, made by WebCrypto a row at a time (checked against
  OpenSSL). Every table has the same columns, so one query serves every
  peer. Changes come out element by element: askers update their hints
  (`updateHint`), and a peer answers a hint a few versions old (`rewind`).
  Dimension 1408, noise standard deviation 6.4 (HintlessPIR's update of
  SimplePIR's, for 128-bit security), p = 512 (decryption fails about
  2^-75 per element even for a worst-case table).
- **`src/js/contexts.js`**, the memory as such a table: a record chosen by a
  hash of the 12 characters before a word start (case folded); each entry
  carries 16-bit tags of the 24, 48 and 64 characters before, a count, and
  up to 30 bytes of what followed (cut after a whole word: a ghost ending
  mid-word got finished wrong, "thi" becoming "thiude"). The asker finds
  the longest match itself from the tags, keeping continuations that start
  with the letters typed, and gets `{ L, spans }` as from `memory.js`. A
  record is six slots of 40 bytes, keeping the continuations repeated most
  under their key, then the newest; an entry that comes or goes changes its
  own slot only (packed end to end, one line changed 3-4 times as much).
- **`src/js/private.js`**, the protocol, on a torrent of its own
  (`swarmFile`) with a BEP 10 extension (`src_pir`): an asker says hello
  with a nonce; a peer offers its table (version, size, and, with a key,
  its public key and a signature of the nonce); the asker fetches the hint
  in parts; queries go in parts too (no message over 32 KiB: a data channel
  to Node takes 64 KiB at most, and a larger message ends the connection);
  answers come back for the asker's version; peers push small changes, or a
  new offer. An asker with pinned keys counts peers proving one fully and
  the rest for half in the vote (the memory as a whole counts fully either
  way, as the chat's does), and gives a pinned peer's hint a slot first;
  `pinnedOnly` hears no one else. A cautious asker keeps continuations with
  digits, links or addresses only where two peers agree. A peer gives out
  a budget: a browser, 6 hints a minute and 20 answers a second in all. A question is about its key's record, so the
  asker fetches it as a word starts (`prefetch`) and answers every guess in
  that word from it, at once; it keeps 64 records for two minutes, or until
  a peer changes; with no mask made, only the latest fetch waits for one.
- **The library peers** (`containers/node/peers.js`) answer privately too
  (`PEER_PRIVATE`, on): a table of their text (`PEER_PRIVATE_GROUPS`, 4 for
  the git library: about 900,000 characters held well), and a key
  (`PEER_KEY`, its public key logged at start). Compose passes all three.
- **Browsers answer** (`answering.js`, `answer.worker.js`; the user's call,
  2026-11-26: "we shouldn't be forcing everything through a physical
  server"): every tab of the site, and the extension's background, answer
  from the chat they keep (`library.js`, every room, each line weighted by
  the quality rules), in a worker, so the page never waits: the table as
  the page starts (if there are 4,000 characters or more), then changed a
  line at a time (`createShelves` in `contexts.js`: a line kept makes an
  entry at each word start, a line dropped takes back what it made; the
  table equals the one built at once), within 250 ms of each line (the
  extension's background hears its terminal's lines by the storage
  event). Only the elements that changed go to askers, in parts.
- **The extension** (`extension/host.js`, `page.js`): the background joins
  the private swarm when a page or terminal first connects, on the radio's
  torrent client, asking and answering; pages tell it when a word starts;
  page guesses ask (one query per word, never a follow-up), cautiously,
  the libraries pinned in `SRC_PINNED_KEYS` at build (the site's config,
  `pinned`) counting above the rest. The terminal's ticker shows `private`:
  peers, ready, pinned, asked, answered, dropped, and `serving`, the
  characters the background answers from. The listing, reviewer notes and
  `/ghost` welcome line say what leaves the device: encrypted questions
  only.
- Tests: `pir`, `contexts`, `private` (26), with fake wires that refuse
  messages over a data channel's limit.

## Measured

Node 22, the user's 8-core desktop, one thread, real shape:

| | tab table (1 group, 4 MiB) | library table (4 groups, 16 MiB) |
|---|---|---|
| Build and hint | 7-9 s (450,000 characters) | 30 s (1.8M characters) |
| A chat line in, the oldest of its room out | 7-34 ms; 430-3,200 elements to each asker (5-38 KB) | |
| Hint, to each asker once per version | 1.28 MB | 5.1 MB |
| Peer: answer a query | 6.3 ms | about 25 ms |
| Asker: a mask (made ahead) | 130 ms | 130 ms |
| Asker: read an answer | 0.7 ms | 0.7 ms |
| Query up / answer down | 64 KiB / 0.9 KiB | 64 KiB / 3.6 KiB |

How often the top continuation's first word is the word actually typed
next, on FineWeb (web pages, ASCII as the library keeps text), against the
suffix array (`memory.js`):

| | text the memory holds | unseen pages |
|---|---|---|
| suffix array | 100% | 12-19% |
| table, 450,000 characters per group | 89% | 2.5% |
| table, 225,000 per group | 95.5% | |
| table, 112,000 per group | 97.3% | |

On unseen pages the suffix array matches as few as 8 characters, through
the word being typed; the table needs the exact 12 before the word. A key
of 8 lifted unseen pages to 5.9% but dropped held text to 71%; the worker
weighs memory by match length (0.22 at 12 characters, 0.7 at 48), so held
text is where it matters, and the key stays 12.

Transport: a tiny message's round trip to a local peer took 1-2 ms; a
query, 150-185 ms (a data channel ramps up slowly after a pause, and a
64 KiB burst takes several round trips; over the internet, worse). Fetching
as the word starts hides it behind the typing.

End to end (headless Chromium and Firefox, the extension built with the
local library's key pinned, the library holding 450,000 characters of
FineWeb): typing the start of a line the library holds into a plain page's
textarea, the ghost went on with the library's words ("effects and
animation in film", "hardly needed. Two of the four..."), where the model
alone wrote something else; a continuation with a number ("across 46
states") was refused, one peer saying it; about one query per word.

With no server (the extension pinned to a library that is down; a tab of
the site keeping the same text as chat): the extension held the tab's hint
21 s after the tab loaded (making the table and hint, finding each other,
the transfer; it was 36 s with a deliberate 20 s wait, gone at the user's
word), and the ghost followed the tab's memory the same way; a line then
said in the tab reached the extension's ghost 9.6 s later, as changes, no
new hint ("blue house on Cedar Street"); the tab's page had no long task
throughout. The extension's background made its own table 34 s after its
terminal's library changed (then with a 30 s wait, since gone). At first
unpinned answers also counted for half overall, and the ghost only
half-followed; now they count for half only against pinned peers in the
vote.

## Not built yet

- **Deploying the servers' part** (optional now): the user sets `PEER_KEY`
  on each server, rebuilds the library image, lists the logged keys in
  `SRC_PINNED_KEYS`, and rebuilds the extension. Tabs answer meanwhile.
- **Hints kept across restarts**: each browser session downloads each
  library's hint again (1.3-5 MB).
- **A tab answering on a phone**, with the model running: unmeasured.
- **A way to turn it off** without turning the ghost off (`/ghost` has no
  switch for the memory).

## Open questions

- **Parameters**: check n = 1408, sigma = 6.4 with the lattice estimator;
  rotate A's seed (FrodoPIR counts a cost per query under one A).
- **What still leaks**: when words start (one query each), and the asker's
  IP address over direct WebRTC. A fixed cadence while a field has focus,
  and a relay, would hide them, at a cost.
- **Mozilla's data declaration**: whether encrypted questions about page
  text count as collecting it (the manifest declares only chat).
- **Unseen text**: a second lookup keyed through the letters typed would
  catch short matches, at twice the upload.
- **Poisoning**: anyone can answer now, so Sybils can too: pinned peers
  win the vote when present, and the cautious rule keeps out numbers and
  links from one peer; a planted continuation without them still gets
  through, as in the chat's memory today. Two Sybils agreeing pass the
  cautious rule.
- **What answering costs a visitor**: every tab with enough chat makes a
  table (a few seconds in a worker, 4 MiB, a 1.3 MB hint) and serves a few
  hints and answers; on a phone, untested.
- **Bandwidth**: 64 KiB per word per library; fewer columns trade upload
  for larger hints.
