# Extension: the terminal in the browser, ghost text on every page

> Status: **idea, not started** (2026-11-21). Nothing is built. Written
> after ghost text shipped on the site (see CLAUDE.md).

## The one line

Package src as a browser extension: the terminal in a side panel, the
radio and chat in the background, and the ghost text offered in any
text field on any page.

## Why

- **Writing everywhere.** Ghost text works in the site's command line. An
  extension could offer the same in any input on any page: start typing,
  the writer writes ahead, Tab keeps it.
- **Seeding that outlives the tab.** A browser stays open far longer than
  a tab. Songs a listener holds would keep seeding to others for as long
  as the browser runs, which is what the swarm needs.

## Shape

- **One model per browser, not per tab.** The model (137 MB, up to 4
  threads), the WebTorrent client, chat and radio live in the extension's
  background. Content scripts on pages only draw the ghost and ask the
  background for guesses. A model per tab would be unusable.
- **Chrome and Firefox differ here.**
  - Chrome (Manifest V3): the background is a service worker, which has
    no Workers, no WebRTC and no audio. Those need an offscreen document
    (`chrome.offscreen`), and Chrome allows one per extension. An
    offscreen document opened for audio is closed after about 30 s of
    silence; how long one opened for WebRTC or Workers lives is untested.
  - Firefox: no offscreen documents, but a background page has a DOM and
    can do all of it. `../ext` used Manifest V2 there with a persistent
    background page; check whether that is still accepted, or what
    Manifest V3's non-persistent background does to WebRTC connections.
- **The terminal in a side panel**, not a popup: popups close as soon as
  focus leaves them. Chrome has `sidePanel`; Firefox has `sidebar_action`.
  Closing the panel would not stop the radio or chat.
- **One code base.** The site stays the source of truth; the extension is a
  second build target in `scripts/build.js` (manifests per browser, as in
  `../ext/public/manifest.*.json`), not a fork.

## What `../ext` already worked out

`../ext` ("Domino", 2024) shipped to both stores:

- Chrome on Manifest V3 (service worker plus the `offscreen` permission),
  Firefox on Manifest V2 (background scripts), from one webpack build with
  a manifest per browser.
- transformers.js bundled into the extension; CSP with `'wasm-unsafe-eval'`.
- `package.sh` zips the source next to each browser's build, for Firefox's
  reviewers.
- History worth reading before submitting again: "try to submit chrome
  extension again, still using remote onnx" and "update mozilla listing,
  trying to avoid delisting". Both stores ban remotely hosted code, so
  transformers.js and ONNX Runtime's WASM files must ship inside the
  extension (the site loads them from jsdelivr today). Model weights are
  data rather than code and are normally allowed from Hugging Face, but
  `../ext` chose to bundle its models (git LFS) to be safe.

## The hard parts

1. **Ghost text on other people's pages is a long tail.**
   - Plain `<input>` and `<textarea>`: workable. Textareas wrap, so the
     caret's position comes from a mirror element with the same styles.
   - Rich editors (Gmail, Slack, Discord, Notion) are contenteditable trees,
     each with its own rules.
   - Framework-controlled fields (React and the like) ignore a plain
     `value` change; accepting text needs the native setter and an `input`
     event.
   - Some sites use Tab themselves.
   - Canvas editors (Google Docs) draw their text; there is no DOM text to
     read. See below.
2. **The model is small for arbitrary writing.** SmolLM2-135M writes
   chat-sized lines well; in an email or a form its guesses will be generic.
   On a random page the context is the field's own text (maybe the page's
   title), not a room's conversation. SmolLM2-360M would help and runs
   about 3x slower.
3. **Privacy and review.** A content script that watches typing on every
   site brings the "read and change all your data on all websites" warning.
   It must never touch password fields or payment fields
   (`autocomplete="cc-*"`), should be off by default per site, and must say
   plainly that nothing leaves the device.
4. **Radio in the background.**
   - Streaming relies on WebTorrent's service worker (`sw.js`); in Chrome
     the extension's own service worker would have to play that part.
   - Storage is per origin: songs the site already holds do not carry over,
     so the extension starts empty.
   - Seeding all day uses upload bandwidth and shows the listener's IP
     address to peers. Opt-in, and visible (a toolbar badge).

## Canvas editors: reading pixels

Google Docs renders its text to a canvas, so a content script cannot read
what is written. The user's idea: read the pixels and extract the text,
with a vision model. Options, cheapest first:

- **A text layer Google provides.** When Docs moved to canvas rendering
  (2021), Google said extensions could be allowlisted for an "annotated
  canvas" that keeps text in the DOM, and Docs has a screen reader mode.
  Check whether either still exists and is open to us; if so, no pixels.
- **OCR.** Document text is clean, rendered type: classic OCR
  (Tesseract.js, in WASM) reads it well and is far lighter than a vision
  language model. Only the paragraph around the caret matters.
- **A small vision language model** (SmolVLM-256M or Florence-2's OCR task
  through transformers.js): heavier (hundreds of MB, seconds per image on
  the CPU), but copes with layout, tables and odd fonts.

Whatever reads the text, it should not run on every keystroke: read once
when the visitor pauses or moves the caret, then track what they type from
key events until the next read. Pixels can come from
`chrome.tabs.captureVisibleTab` (rate-limited to a couple of calls a
second) or from the Docs canvas itself, if the content script can read it.
Docs' caret is still a DOM element, so the ghost can be placed. Accepting
text means typing into Docs' hidden text-event iframe, which is how other
extensions insert text there. All of this is unverified.

## Phases

1. **The terminal in a side panel, radio and chat in the background.**
   Mostly the site as it is, and the seeding benefit at once. No access to
   other sites, so the easier review.
2. **Ghost text on plain inputs and textareas,** opt-in per site, skipping
   password and payment fields.
3. **Rich editors**, one at a time, by demand.
4. **Canvas editors**, through a text layer if one exists, else OCR.

## Open questions

- Does Firefox still accept a Manifest V2 background page, and if not,
  does a Manifest V3 background keep WebRTC connections alive?
- How long does Chrome keep an offscreen document for WebRTC or Workers?
- Is ONNX Runtime's Firefox thread hang (CLAUDE.md) the same in an
  extension's background page?
- Can one tab's guess requests starve another's? (One model, many tabs: the
  focused field should win.)
