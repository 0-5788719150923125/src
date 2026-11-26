// Ghost text on other sites: as you type in a page's text field, PEN@ROOT
// (the extension's model, host.js) guesses how the line goes on, and the
// guess is drawn after the caret, faded, with the site's wave running
// along it. It works like the terminal's (src/js/ghost.js): Tab keeps it a
// word at a time, as if typed; held, it keeps words quickly until
// released. Escape hides it. Typing what it shows keeps it; typing anything
// else drops it, and a new guess comes once the typing pauses. Tab and
// Escape are taken only while a guess is showing, so a page keeps them
// otherwise.
//
// Fields: <input type=text> (or no type), <textarea>, and contenteditable
// editors, which is what chat boxes, comment boxes and mail are made of. Never
// a password, never a field the page marks for personal details
// (autocomplete: payment, address, phone, one-time codes...), never a code
// editor (which wants Tab for itself), and only while the caret is at the
// end of what is written (anything but spaces after it, and the guess
// would be drawn over it). /ghost in the terminal turns it off everywhere
// or on one site (chrome.storage).
//
// What is typed goes to the extension's own model (host.js), which asks
// the swarm's memory about it only as an encrypted question. The
// guess is drawn in a closed shadow root on top of the page, so the page's
// styles cannot reach it and its scripts cannot read it; it takes no
// clicks. Accepted words go in with execCommand('insertText'), which the
// page sees as typing (frameworks hear their input events, and undo works).
//
// The build (scripts/extension.js) packs this module and what it imports
// into one classic script, which is what a content script must be.

import { ahead } from '../src/js/predict.js'

;(() => {
    const api = globalThis.browser ?? globalThis.chrome
    if (!api?.runtime?.id || globalThis.__srcGhost) return
    globalThis.__srcGhost = true

    const PAUSE = 150 // ms of quiet before a guess
    // A guess that has shown nothing and not finished after this long is
    // taken for lost (the host restarted, a message dropped) and asked again,
    // up to RETRIES times for the same text.
    const STUCK = 5000
    const RETRIES = 2
    // Held, Tab keeps a word every TAKE_EVERY ms once HOLD ms have passed.
    const HOLD = 220
    const TAKE_EVERY = 25
    // Characters before the caret the model reads. The start stays put, so
    // the host's model keeps what it has read cached, until the text passes
    // MOST; then it jumps ahead until about LEAST remain (src/js/predict.js
    // start does the same with the chat's lines).
    const MOST = 2400
    const LEAST = 1200
    // How faded the guess is: the field's own text color, at this opacity.
    const FADE = 0.5

    // ------------------------------------------------------------ settings

    // The site, for /ghost's per-site setting: an about:blank or srcdoc
    // frame has no host of its own, but its parent's origin.
    const site = (() => {
        try {
            return location.hostname || new URL(origin).hostname
        } catch {
            return ''
        }
    })()
    let settings = { on: true, sites: {} }
    const enabled = () =>
        Boolean(site) && (settings.sites?.[site] ?? settings.on) !== false
    const read = (stored) => {
        if (stored && typeof stored === 'object')
            settings = { on: stored.on !== false, sites: stored.sites || {} }
    }
    api.storage?.local.get('ghost').then(
        (got) => read(got?.ghost),
        () => {}
    )
    api.storage?.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.ghost) return
        read(changes.ghost.newValue)
        if (!enabled()) {
            drop()
            draw()
        }
    })

    // ------------------------------------------------------------ fields

    // Autocomplete hints for personal details: such fields get no guesses.
    // (A hint the page made up, or "off", is no reason to stay away: chat
    // boxes often say "off".)
    const PRIVATE =
        /\b(cc-|one-time-code|password|username|email|tel|street-address|address-|postal-code|country|bday|sex|honorific|given-name|family-name|additional-name|nickname|organization|webauthn)/
    // Code editors want Tab for themselves. A page can opt any field out
    // with data-src-ghost="off": the site's own command line does, since it
    // has a ghost of its own (src/index.html).
    const CODE_EDITORS =
        '.cm-editor, .CodeMirror, .monaco-editor, .ace_editor, [data-src-ghost="off"]'
    const NOT_TYPED = /^(numeric|decimal|tel|email|url|none)$/

    // The field a node belongs to, as { el, kind }, or null for anything
    // that should get no guess.
    function fieldOf(node) {
        if (!node || node.nodeType !== 1) return null
        let el = node
        let kind = null
        if (el instanceof HTMLInputElement) {
            if (el.type !== 'text') return null
            kind = 'input'
        } else if (el instanceof HTMLTextAreaElement) {
            kind = 'textarea'
        } else if (el.isContentEditable) {
            // The editing host: the outermost editable element.
            while (el.parentElement?.isContentEditable) el = el.parentElement
            kind = 'editable'
        } else return null
        if (el.readOnly || el.disabled) return null
        if (PRIVATE.test((el.getAttribute('autocomplete') || '').toLowerCase()))
            return null
        if (NOT_TYPED.test(el.getAttribute('inputmode') || '')) return null
        // Search boxes and the like bring their own suggestions, and their
        // own use of Tab.
        if (/combobox|searchbox/.test(el.getAttribute('role') || ''))
            return null
        if (el.closest(CODE_EDITORS)) return null
        if (getComputedStyle(el).direction === 'rtl') return null
        // A field too small to see, or in a frame too small to see, is a
        // page's own machinery (Google Docs types into a hidden frame).
        const box = el.getBoundingClientRect()
        if (
            box.width < 8 ||
            box.height < 8 ||
            innerWidth < 40 ||
            innerHeight < 12
        )
            return null
        return { el, kind }
    }

    // The focused element, inside open shadow roots too.
    function focused() {
        let at = document.activeElement
        while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement
        return at
    }

    // A contenteditable's selection lives in the shadow root that holds it,
    // where browsers say so (Chrome's shadowRoot.getSelection).
    const selectionIn = (el) => {
        const root = el.getRootNode()
        return (
            (root !== document && root.getSelection?.()) ||
            document.getSelection()
        )
    }

    const BLOCKS =
        /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/

    // The text of a fragment as it reads: line breaks for <br> and between
    // blocks, no-break spaces as spaces.
    function textOf(fragment) {
        let out = ''
        const walk = (node) => {
            if (node.nodeType === 3) out += node.data
            else if (node.nodeName === 'BR') out += '\n'
            else if (node.nodeType === 1 || node.nodeType === 11) {
                const block = BLOCKS.test(node.nodeName)
                if (block && out && !out.endsWith('\n')) out += '\n'
                for (const child of node.childNodes) walk(child)
            }
        }
        walk(fragment)
        return out.replace(/\u00a0/g, ' ').replace(/[\u200b\ufeff]/g, '')
    }

    // What is written before the caret, and whether the caret is at the end
    // of everything written (only spaces after it), or null when there is a
    // selection or no caret in the field.
    function caretIn({ el, kind }) {
        if (kind !== 'editable') {
            const { selectionStart: start, selectionEnd: end, value } = el
            if (start === null || start !== end) return null
            return {
                before: value.slice(0, start),
                atEnd: !/\S/.test(value.slice(start))
            }
        }
        const selection = selectionIn(el)
        if (!selection?.rangeCount || !selection.isCollapsed) return null
        const caret = selection.getRangeAt(0)
        if (!el.contains(caret.startContainer)) return null
        const before = document.createRange()
        before.setStart(el, 0)
        before.setEnd(caret.startContainer, caret.startOffset)
        const after = document.createRange()
        after.setStart(caret.endContainer, caret.endOffset)
        after.setEnd(el, el.childNodes.length)
        return {
            before: textOf(before.cloneContents()),
            atEnd: !/[^\s\u200b\ufeff]/.test(after.toString()),
            caret
        }
    }

    // ------------------------------------------------------------ the host

    let port = null
    let connecting = null
    let ready = false

    // The extension was reloaded or removed: this script is an orphan, and
    // its API calls throw.
    const alive = () => Boolean(api.runtime?.id)

    function connect() {
        if (port || connecting || !alive()) return
        // In Chrome the host is opened on request; Firefox's is the
        // background page, woken by the message. Refused, the extension was
        // reloaded or removed since this page loaded: no ghost here until
        // the page is reloaded too.
        connecting = api.runtime
            .sendMessage({ type: 'host' })
            .then(() => {
                const opened = api.runtime.connect({ name: 'pen' })
                opened.onMessage.addListener(onHost)
                opened.onDisconnect.addListener(() => {
                    if (port === opened) port = null
                    ready = false
                    drop()
                    draw()
                })
                port = opened
            })
            .catch(() => (port = null))
            .finally(() => (connecting = null))
    }

    function onHost(message) {
        if (typeof message?.ready === 'boolean') {
            const was = ready
            ready = message.ready
            // Text typed while the model loaded is guessed once it is ready.
            if (ready && !was) changed(true)
        }
        const ghost = message?.ghost
        if (!ghost || current?.id !== ghost.id) return
        clearTimeout(watchdog)
        // Corrected by the swarm: written again from the start.
        if (ghost.reset) Object.assign(current, { written: '', done: false })
        if (ghost.text) current.written += ghost.text
        if (ghost.done) current.done = true
        // Taken whole before it finished: guess on from the end. (A guess
        // that wrote nothing ends there.)
        if (current.done && current.written && shown() === '') changed(true)
        draw()
    }

    function send(message) {
        try {
            port?.postMessage(message)
            return Boolean(port)
        } catch {
            port = null
            return false
        }
    }

    // ------------------------------------------------------------ guesses

    let field = null // { el, kind }: the field being typed in
    let current = null // { id, base, written, done, el }
    let last = null // what was before the caret as last seen
    let timer = null
    let watchdog = null
    let retries = 0
    let next = 0
    let started = null // the text before the last word start told to the host
    const starts = new WeakMap() // field -> where in its text the model starts reading

    const wanted = (text) => /\S/.test(text)

    // What the guess still shows after the text before the caret, or null.
    function shown(state = field && caretIn(field)) {
        if (!current || !state || current.el !== field?.el) return null
        return ahead(current, state.before)
    }

    // Where the model starts reading this field's text.
    function startOf(el, before) {
        let from = starts.get(el) ?? 0
        if (from > before.length) from = 0
        if (before.length - from > MOST) {
            from = before.length - LEAST
            // From the start of a word.
            const gap = /\s/.exec(before.slice(from))
            if (gap) from += gap.index + 1
        }
        starts.set(el, from)
        return from
    }

    function ask() {
        if (!field || !enabled()) return
        const state = caretIn(field)
        if (!state?.atEnd || !wanted(state.before)) return
        connect()
        if (!ready) return
        const id = ++next
        const { before } = state
        if (
            !send({
                guess: {
                    id,
                    line: before.slice(startOf(field.el, before)),
                    title: document.title,
                    site
                }
            })
        )
            return
        current = { id, base: before, written: '', done: false, el: field.el }
        clearTimeout(watchdog)
        watchdog = setTimeout(() => {
            if (
                current?.id !== id ||
                current.written ||
                current.done ||
                retries >= RETRIES
            )
                return
            retries++
            drop()
            ask()
        }, STUCK)
    }

    function drop() {
        if (current) send({ stop: true })
        current = null
        clearTimeout(timer)
        clearTimeout(watchdog)
    }

    // Called whenever the text or the caret may have changed.
    function changed(again = false) {
        if (!field || !enabled()) return draw()
        const state = caretIn(field)
        const before = state?.before ?? null
        if (before === last && !again) return draw()
        if (before !== last) retries = 0
        last = before
        // A word starts: what the swarm's memory holds for it can be fetched
        // while it is typed (host.js), so the guesses within it need not wait.
        if (ready && state?.atEnd && before !== started && /\s$/.test(before)) {
            started = before
            send({
                prefetch: { line: before.slice(startOf(field.el, before)) }
            })
        }
        const rest = shown(state)
        // Guess anew once the typing pauses, unless the guess still has
        // something to show or is still being written.
        if (rest === null || (rest === '' && current.done)) {
            drop()
            if (state?.atEnd && wanted(before)) timer = setTimeout(ask, PAUSE)
        }
        draw()
    }

    // ------------------------------------------------------------ drawing

    // The guess is drawn in a layer over the whole page: a closed shadow root
    // in a popover when the browser has them (the top layer, above the
    // page's own modals), else at the highest z-index. A clip box lies over
    // the field, and the guess sits in it where the field's text would go
    // on, in the field's own font: for <input> and <textarea>, after a copy
    // of the text before the caret, unseen, laid out as the field lays it
    // out; for a contenteditable, from the caret's own position, wrapping
    // within the editor's width.
    const CSS = `
        .clip { position: fixed; overflow: hidden; pointer-events: none; }
        .copy, .line { position: absolute; margin: 0; border: 0 solid transparent; pointer-events: none; overflow-wrap: break-word; text-align: left; box-sizing: content-box; }
        .copy { overflow: hidden; }
        .typed { color: transparent; }
        .ghost {
            opacity: ${FADE};
            mask-image: linear-gradient(90deg, #000 40%, rgba(0, 0, 0, 0.2) 50%, #000 60%);
            mask-size: 300% 100%;
            mask-position: 100% 0;
            animation: wave 3s linear infinite;
        }
        @keyframes wave {
            0% { mask-position: 100% 0; }
            60%, 100% { mask-position: 0% 0; }
        }
        .ghost:empty { animation: none; }
        @media (prefers-reduced-motion: reduce) { .ghost { animation: none; } }
        .probe { position: fixed; left: 0; top: 0; visibility: hidden; white-space: pre; }
    `
    const HOST_STYLE =
        'all: initial !important; position: fixed !important; left: 0 !important; top: 0 !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: visible !important; background: transparent !important; pointer-events: none !important; z-index: 2147483647 !important;'
    const FONT = [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'fontStretch',
        'fontVariant',
        'fontFeatureSettings',
        'fontKerning',
        'letterSpacing',
        'wordSpacing',
        'textTransform',
        'tabSize',
        'lineHeight',
        'wordBreak'
    ]

    let layer = null

    function view() {
        if (layer?.host.isConnected) return layer
        const host = document.createElement('src-ghost')
        host.setAttribute('style', HOST_STYLE)
        if ('popover' in host) host.popover = 'manual'
        const root = host.attachShadow({ mode: 'closed' })
        const make = (tag, className, ...children) => {
            const node = document.createElement(tag)
            if (className) node.className = className
            node.append(...children)
            return node
        }
        const style = make('style')
        style.textContent = CSS
        const parts = {
            typed: make('span', 'typed'),
            copyGhost: make('span', 'ghost'),
            lineGhost: make('span', 'ghost'),
            probe: make('span', 'probe')
        }
        const copy = make('div', 'copy', parts.typed, parts.copyGhost)
        const line = make('div', 'line', parts.lineGhost)
        const clip = make('div', 'clip', copy, line)
        root.append(style, clip, parts.probe)
        document.documentElement.append(host)
        layer = { host, clip, copy, line, ...parts }
        return layer
    }

    // Out of the top layer too, so the next guess goes in above whatever
    // the page has put there since.
    function hide() {
        if (!layer) return
        layer.copyGhost.textContent = ''
        layer.lineGhost.textContent = ''
        layer.typed.textContent = ''
        layer.clip.style.display = 'none'
        if (isOpen(layer.host)) layer.host.hidePopover()
    }

    // A popover in the top layer (none where the browser has no popovers).
    function isOpen(host) {
        return Boolean(host.popover) && host.matches(':popover-open')
    }

    const px = (value) => parseFloat(value) || 0

    function draw() {
        const state = field && enabled() ? caretIn(field) : null
        const rest = state?.atEnd ? shown(state) : null
        if (!rest) return hide()
        const hidden =
            !layer?.host.isConnected || layer.clip.style.display === 'none'
        const l = view()
        // Into the top layer, above whatever the page put there before.
        if (hidden && l.host.popover && !isOpen(l.host)) l.host.showPopover()
        l.clip.style.display = 'block'
        const { el, kind } = field
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        // The padding box, where a field's text can show.
        const inner = {
            left: box.left + px(style.borderLeftWidth),
            top: box.top + px(style.borderTopWidth),
            width: el.clientWidth,
            height: el.clientHeight
        }
        if (kind === 'editable') return drawAtCaret(l, el, state, rest, inner)
        l.line.style.display = 'none'
        l.lineGhost.textContent = ''
        Object.assign(l.clip.style, {
            left: `${inner.left}px`,
            top: `${inner.top}px`,
            width: `${inner.width}px`,
            height: `${inner.height}px`
        })
        const copy = l.copy.style
        for (const name of FONT) copy[name] = style[name]
        Object.assign(copy, {
            display: 'block',
            left: '0px',
            top: '0px',
            width: `${Math.max(inner.width - px(style.paddingLeft) - px(style.paddingRight), 0)}px`,
            height: `${Math.max(inner.height - px(style.paddingTop) - px(style.paddingBottom), 0)}px`,
            padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
            textIndent: style.textIndent,
            color: style.color,
            whiteSpace: kind === 'input' ? 'pre' : 'pre-wrap'
        })
        // A single line sits in the middle of an <input>, whatever its
        // line height says.
        if (kind === 'input') copy.lineHeight = copy.height
        l.typed.textContent = state.before
        l.copyGhost.textContent = rest
        l.copy.scrollTop = el.scrollTop
        l.copy.scrollLeft = el.scrollLeft
    }

    // A contenteditable: the guess starts at the caret and wraps within the
    // editor's width, in the font of the text at the caret. It may run
    // below the editor (most grow as they fill), but not past its sides.
    function drawAtCaret(l, el, state, rest, inner) {
        l.copy.style.display = 'none'
        l.typed.textContent = ''
        l.copyGhost.textContent = ''
        const at = caretRect(el, state.caret)
        if (!at) return hide()
        const holder =
            state.caret.startContainer.nodeType === 1
                ? state.caret.startContainer
                : state.caret.startContainer.parentElement
        const style = getComputedStyle(holder || el)
        const outer = getComputedStyle(el)
        const left = inner.left + px(outer.paddingLeft)
        const width = Math.max(
            inner.width - px(outer.paddingLeft) - px(outer.paddingRight),
            0
        )
        // The line's height, measured in its font; the caret is the height
        // of the text, centered in it.
        const probe = l.probe.style
        for (const name of FONT) probe[name] = style[name]
        l.probe.textContent = '\u200b'
        const lineHeight = l.probe.getBoundingClientRect().height || at.height
        const top = at.top - (lineHeight - at.height) / 2
        Object.assign(l.clip.style, {
            left: `${inner.left}px`,
            top: `${inner.top}px`,
            width: `${inner.width}px`,
            height: `${Math.max(window.innerHeight - inner.top, 0)}px`
        })
        const line = l.line.style
        for (const name of FONT) line[name] = style[name]
        Object.assign(line, {
            display: 'block',
            left: `${left - inner.left}px`,
            top: `${top - inner.top}px`,
            width: `${width}px`,
            padding: '0',
            lineHeight: `${lineHeight}px`,
            textIndent: `${Math.max(at.left - left, 0)}px`,
            color: style.color,
            whiteSpace: 'pre-wrap'
        })
        l.lineGhost.textContent = rest
    }

    // Where the caret is drawn, as { left, top, height }. A collapsed range
    // often has no box (at the start of an empty line, or beside an
    // element); then the end of what comes before it, or the start of its
    // line's block.
    function caretRect(el, caret) {
        const rects = caret.getClientRects()
        if (rects.length) {
            const r = rects[rects.length - 1]
            return { left: r.left, top: r.top, height: r.height }
        }
        const node = caret.startContainer
        const at = caret.startOffset
        const prev = node.nodeType === 3 ? node : node.childNodes[at - 1]
        if (prev?.nodeType === 3 && prev.length && (node !== prev || at > 0)) {
            const range = document.createRange()
            const end = node === prev ? at : prev.length
            range.setStart(prev, end - 1)
            range.setEnd(prev, end)
            const r = range.getBoundingClientRect()
            if (r.height) return { left: r.right, top: r.top, height: r.height }
        } else if (prev?.nodeType === 1 && prev.nodeName !== 'BR') {
            const boxes = prev.getClientRects()
            const r = boxes[boxes.length - 1]
            if (r?.height)
                return { left: r.right, top: r.top, height: r.height }
        }
        const block = (node.nodeType === 1 ? node : node.parentElement) ?? el
        const r = block.getBoundingClientRect()
        const s = getComputedStyle(block)
        return {
            left: r.left + px(s.borderLeftWidth) + px(s.paddingLeft),
            top: r.top + px(s.borderTopWidth) + px(s.paddingTop),
            height: (px(s.fontSize) || 16) * 1.15
        }
    }

    // ------------------------------------------------------------ keeping it

    // Put text in the field as if typed: the page hears it as input, and
    // undo takes it back.
    function insert(text) {
        const { el, kind } = field
        if (document.execCommand('insertText', false, text)) return
        if (kind === 'editable') return
        const at = el.selectionStart
        el.setRangeText(text, at, el.selectionEnd, 'end')
        el.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                composed: true,
                inputType: 'insertText',
                data: text
            })
        )
    }

    // Keep the guess's next word (its leading space and any punctuation
    // stuck to it).
    function takeWord() {
        const state = field && caretIn(field)
        const rest = state?.atEnd ? shown(state) : null
        if (!rest) return
        insert(/^\s*\S+/.exec(rest)?.[0] ?? rest)
        changed()
    }

    let holding = null

    function release() {
        clearTimeout(holding?.delay)
        clearInterval(holding?.repeat)
        holding = null
    }

    const visible = () =>
        Boolean(
            layer &&
            (layer.copyGhost.textContent || layer.lineGhost.textContent)
        )

    // Only the visitor's own keys: a page's made-up key events (isTrusted
    // false) cannot take a guess, or use the model through it.
    function onKeyDown(event) {
        if (event.isComposing || !field || !event.isTrusted) return
        const plain = !event.ctrlKey && !event.altKey && !event.metaKey
        if (event.key === 'Tab' && !event.shiftKey && plain) {
            // A held Tab keeps its keys, even once the guess is all kept,
            // so the focus does not jump away mid-hold.
            if (!holding && !visible()) return
            event.preventDefault()
            event.stopImmediatePropagation()
            if (event.repeat || holding) return
            takeWord()
            const hold = (holding = {
                delay: setTimeout(
                    () => (hold.repeat = setInterval(takeWord, TAKE_EVERY)),
                    HOLD
                )
            })
        } else if (event.key === 'Escape' && visible()) {
            event.preventDefault()
            event.stopImmediatePropagation()
            drop()
            draw()
        }
    }

    function onKeyUp(event) {
        if (!event.isTrusted) return
        if (event.key === 'Tab' && holding) {
            release()
            event.stopImmediatePropagation()
        }
        if (field) changed()
    }

    // ------------------------------------------------------------ events

    // The field the focus went to, if it gets guesses.
    function onFocus() {
        const found = enabled() ? fieldOf(focused()) : null
        if (found?.el === field?.el) return
        release()
        drop()
        field = found
        last = null
        draw()
    }

    // Everything is listened for on the window, at the capture phase, from
    // the moment the page starts, so a page's own handlers cannot swallow
    // Tab first. Events from inside shadow roots arrive here too.
    addEventListener('keydown', onKeyDown, true)
    addEventListener('keyup', onKeyUp, true)
    addEventListener('focusin', onFocus, true)
    addEventListener('focusout', () => setTimeout(onFocus), true)
    addEventListener('input', () => field && changed(), true)
    addEventListener('blur', release)
    document.addEventListener('selectionchange', () => field && changed())
    addEventListener('scroll', () => current && draw(), {
        capture: true,
        passive: true
    })
    addEventListener('resize', () => current && draw())
})()
