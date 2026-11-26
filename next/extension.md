# The Extension

*On taking the terminal along, and writing ahead of you everywhere.*

> Status: built (2026-11-25/26) for Chrome and Firefox, tried by the user in Firefox, not yet reviewed or sent to the stores. First written as an idea on 2026-11-21.

---

## A Place You Visit

The site is a place you visit. You open a tab, chat a while, listen to the radio, and close it. When the tab closes, everything stops: the songs you held stop reaching other listeners, the chat goes on without you, and the model that writes ahead of you is gone until next time.

A browser stays open far longer than a tab, and an extension lives as long as the browser does. That gives two reasons to build one.

**Writing everywhere.** On the site, the ghost text works in the command line: you type, a small model on your device guesses the rest, and Tab keeps it. An extension can offer the same in any text field on any page: a comment box, a chat, an email, a form.

**Sharing that outlives the tab.** The radio's songs come from other listeners. A browser that keeps sharing all day helps the swarm far more than a tab that stays open for one song.

---

## One Mind per Browser

The model is 137 MB, and takes up to four of the processor's threads while it writes. One copy per tab would be unusable: ten tabs, ten models. So there is one per browser, in the extension's *background*: a page with no window, which runs for as long as the browser does. Web pages only draw the ghost, and ask the background for guesses. One guess runs at a time; a new one, from any tab, stops the last, so the field you are typing in always wins.

The background holds everything else, too: the radio, the chat, and the swarm's memory. The terminal (the toolbar button's popup, or the browser's side panel) is only a window onto it. Close the popup, and the radio plays on, the chat keeps listening, and what was said meanwhile is waiting when you open it again. Everything starts with the browser, from the very first run, before anyone opens the terminal.

Chrome and Firefox make this differently, and finding out how took some digging.

- **Chrome**'s current extensions get a *service worker* as their background: something that wakes for events and sleeps in between, and cannot play audio, connect to peers, or run the model. Those live in an *offscreen document*, a hidden page, of which Chrome allows one per extension. Chrome closes one opened only for audio after 30 seconds of silence, but keeps one opened to run workers until it is closed, so ours asks for all three: workers, audio, and peer connections.
- **Firefox**'s current kind of background is unloaded after 30 seconds without an extension event, open connections or not, which would restart the model after every pause in typing. So the Firefox build uses the previous kind of extension, whose background page stays put. Firefox still accepts it, with no end announced.

`/reset` has to reach the background too, or the radio plays on through it. So the terminal leaves a note, and the background is restarted (Chrome closes the hidden page and opens a new one; Firefox's reloads itself). The new background finds the note and forgets everything before it starts anything.

---

## Ghost Text on Other People's Pages

Writing into somebody else's page is a long tail of special cases.

A plain text box is workable, except for one thing: the ghost has to appear exactly where the caret is, and a text box will not say where that is. So the extension keeps an invisible copy of the text before the caret, laid out exactly like the field (same font, same width, same wrapping, same scrolling), and draws the ghost where the copy ends. Rich editors (Gmail, Slack, Discord, Notion) are trees of formatted text instead; there, the caret's own position can be read, and the ghost wraps within the editor.

The ghost is drawn in a sealed-off layer of its own, above everything on the page, dialogs included, so the page's styles cannot reach it and it cannot disturb the page. Accepted words go in the way typing does, so the frameworks that run many pages (React and the like) notice the change, and undo works.

Tab is the hard key: many pages use it to move between fields, and some to indent. The extension takes Tab only while a guess is showing. Escape dismisses the guess, and then Tab belongs to the page again.

Some fields must never get a ghost: passwords, card numbers, addresses and other personal details, search boxes, code editors, right-to-left text, fields too small to see, and any field with text after the caret. A site can also opt a field out (`data-src-ghost="off"`); the site's own command line does, since it has its own ghost.

---

## Privacy and Review

An extension that watches typing on every site comes with the browser's warning that it can "read and change all your data on all websites", and rightly. So the rules are strict, and the store listing states them plainly.

- **The model runs inside the extension**, on your own processor. What you type in other sites' fields goes to it.
- **Nothing typed there goes anywhere readable.** Guesses on other sites never ask the chat, since a question there would show the chat what you are typing elsewhere. They ask the swarm's memory only with sealed questions, which the answerers cannot read ([private-memory.md](private-memory.md)). Nothing typed on other sites is ever stored.
- **Everything that runs ships inside the extension.** Both stores ban code loaded from elsewhere, so the language-model library and its runtime are fetched when the extension is built, checked against fixed fingerprints, and shipped byte for byte as npm publishes them, so reviewers can compare. Only the model's weights, which are data, download from Hugging Face, once.

Most of this was learned from `../ext`, an earlier extension that shipped to both stores: one build with a description file per browser, the source zipped for Firefox's reviewers, and a history of rejections over code loaded from a CDN.

---

## Canvas Editors

Google Docs draws its text as pixels on a canvas, so there is no text on the page to read. The user's idea: read the pixels. The options, cheapest first:

- **A text layer from Google.** When Docs moved to the canvas in 2021, Google said extensions could be allowed an "annotated canvas" that keeps the text in the page, and Docs has a screen-reader mode. If either is open to us, no pixels are needed at all.
- **Ordinary text recognition** (Tesseract, in the browser). Document text is clean, rendered type, which it reads well, far more cheaply than a vision model. Only the paragraph around the caret matters.
- **A small vision model.** Hundreds of megabytes and seconds per image, but it copes with tables and odd fonts.

Whatever reads the text should read it when you pause or move the caret, not on every key, and follow your typing in between. Docs' caret is still an element on the page, so the ghost can be placed, and other extensions insert text through Docs' hidden typing frame. All of this is unverified.

---

## Where It Stands

The plan had four phases. The first two are built, and more besides.

1. **The terminal, with the radio and the chat in the background.** Built. The popup, Chrome's side panel and Firefox's sidebar are the site itself.
2. **Ghost text in text boxes**, never in sensitive fields. Built, along with rich editors as far as typing into them goes. Checked on a Gmail-like editor, React's text boxes, frames, dialogs, and, by the user, on Pastebin.
3. **Rich editors' own quirks**, one at a time, as they come up. Not started.
4. **Canvas editors.** Not started.

Also not done:

- **The stores.** The user makes the first Chrome Web Store upload and listing by hand, and publishes; after that, `node main.js --publish` uploads new versions, asking first.
- **Edge.**
- **The toolbar badge**, and the side panel and sidebar as real panels (they were checked as pages).
- **Chat in Firefox's background**, untested.
- **Real sites** beyond Pastebin.

---

## The Numbers

- The model, SmolLM2-135M-Instruct: 137 MB, downloaded once. On a fresh browser profile, the first ghost showed 16 seconds after typing began. The terminal's ghost uses the background's model: ready in 0.13 s when warm, 2.9 s cold.
- Firefox gives extension pages no cross-origin isolation (bug 1673477), so the model runs on one thread there; in Chrome, on up to four.
- The background lets the model go after 30 minutes without a guess; the weights stay cached. A text field taking the focus calls it back, so it is up again within a few seconds, often before the first pause in typing.
- Shipped inside: transformers.js 4.3.2, ONNX Runtime Web 1.31.0-dev (its CPU-only build, since the default one calls `new Function`, which Chrome's extension rules forbid), and WebTorrent 3.0.21.
- Chrome: Manifest V3, an offscreen document with the reasons WORKERS, AUDIO_PLAYBACK and WEB_RTC. Firefox: Manifest V2, a persistent background page, version 140 or later.

---

## Where It Lives

- `scripts/extension.js`: the build, a second target of the site's rather than a fork (`node main.js --extension`).
- `scripts/stores.js`: uploads to the stores (`--publish`).
- `extension/background.js`: Chrome's service worker, which opens the background and restarts it.
- `extension/host.js`: the background itself: the model, the radio, the chat, the memory.
- `extension/terminal.js`: the terminal's window onto it.
- `extension/page.js`: the ghost on other sites.
- `src/text/en/extension.md`: the store listing, and the notes for reviewers.
