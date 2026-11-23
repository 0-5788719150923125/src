// /about: the overview (text/<language>/about.md), which links to the code
// and to the original site's archive.

import { say } from './print.js'
import { pick } from './random.js'
import { html, list } from './text.js'

// What the overview calls you, chosen once a visit.
let type = null

export function about() {
    type ??= pick(list('lore.types'))
    say(html('about.overview', { type }), { block: true })
}
