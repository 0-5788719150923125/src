<!-- The browser extension's words outside the terminal. The first three are
how the browser lists it: scripts/extension.js writes them into
_locales/<language>/messages.json, which the manifest names. Chrome cuts a
name at 75 characters and a description at 132. "summary" and "listing" are
the store pages' short and long descriptions, which scripts/stores.js sends
to addons.mozilla.org (the Chrome Web Store takes them in its dashboard).
"reviewers" goes with each version sent to addons.mozilla.org, for
the people who review it. Each entry is used whole, as plain text. -->

# name

The Source

# description

A terminal with peer-to-peer chat, a radio, and a small language model that writes ahead of you in any text field, on your device.

# action

The Source

# summary

A terminal styled after an old computer, with peer-to-peer chat, a radio, and a small language model that runs on your device and writes ahead of you as you type, in the terminal and in other sites' text fields.

# listing

The Source is a terminal in your browser: peer-to-peer chat with strangers, a radio that every listener hears in sync, and PEN@ROOT, a small language model (SmolLM2-135M, or SmolLM2-360M with /model) that runs on your own device.

Click the toolbar button for the terminal. Type to chat in the default chat, trade, or join another with /chat <name>. /radio turns the radio on and off. /help lists every command.

As you type, PEN@ROOT guesses how your line goes on and shows its guess as faded, rippling text after the cursor. Press Tab to keep a word, or hold it to keep them all; Escape hides it. It does the same in text fields on other sites: comment boxes, chat boxes, emails, forms.

Privacy: the model runs inside the extension, on your CPU. What you type in other sites' fields goes to it, and to the swarm's memory only as an encrypted question (private information retrieval): the peers that answer cannot read it, and learn only that a question came, and when. Nothing typed there is stored. Ghost text never appears in password, payment, address or other personal-detail fields. Chat messages you send in the terminal go to the other people in that chat, peer to peer, signed with a key your browser makes for itself. The radio plays on when the popup closes, until you turn it off, and the songs the extension holds are shared with other listeners, peer to peer, while the browser runs. The model's weights (137 MB, or 365 MB for SmolLM2-360M) download once from Hugging Face.

The code is open: https://github.com/0-5788719150923125

# reviewers

Build: node main.js --extension, with Node.js 22 or newer and nothing installed; the source archive is the whole repository, and the build writes build/extension/firefox/ and the zip. The extension's own code is extension/ and the site's modules in src/, unminified.

Third-party files in vendor/ are the published npm files, byte for byte, fetched from cdn.jsdelivr.net at build time and checked against the SHA-256 hashes in scripts/extension.js (VENDOR): @huggingface/transformers 4.3.2 (vendor/transformers.min.js), onnxruntime-web 1.31.0-dev.20260914-8d85527a0 (vendor/ort/, its CPU-only WebAssembly build) and webtorrent 3.0.21 (vendor/webtorrent.min.js). The Function constructor the linter finds in transformers.min.js is in ONNX Runtime's GPU glue, which this extension never runs.

The language model's weights (HuggingFaceTB/SmolLM2-135M-Instruct, or SmolLM2-360M-Instruct when chosen with /model; ONNX) are data, downloaded from huggingface.co on first use and kept in the browser's cache. Text typed in web pages goes to the extension's background page, where the model runs, and is never stored or sent anywhere readable: to ask the library peers' memory, the background sends a private information retrieval query over WebRTC (LWE, in src/js/pir.js and src/js/private.js; the design in next/private-memory.md), from which the answering peer cannot recover the text. PRIVACY.md, at the root of the source archive, is the privacy policy: what the extension sends and stores, and how to check it. With nothing installed, node --test tests/privacy.test.js checks the private queries' encryption, and node main.js --privacy firefox (or chromium) loads the built extension into a fresh headless browser, types into a page's fields and checks that sensitive fields get no ghost text, that a peer's memory reaches the ghost privately, and that nothing typed is stored or sent in the clear. The radio also plays in the background page, so it goes on when the popup closes: its songs come from other listeners over WebRTC and from the mirror (radio.src.eco) over HTTPS, are kept in the extension's private file system, and are shared with other listeners. Chat messages are sent, by the user, to the other people in a chat, over WebRTC. The radio/*.torrent files are data made from a folder of audio files that is not part of the source. That, and the configuration in popup.html and panel.html (the trackers, from the build's .env), is where a build from the source archive differs from the package.
