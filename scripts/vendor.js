#!/usr/bin/env node
// Refresh the vendored browser files from node_modules. Maintenance only:
// the site never runs this, and the files it writes are committed, so
// building and serving need no install.
//
//   npm install && npm run vendor
//
//   src/vendor/webtorrent.min.js   WebTorrent's own ES module build (MIT)
//   src/vendor/webtorrent-sw.js    WebTorrent's streaming service worker,
//                                  loaded by ours (src/sw.js)
//
// Both lose their sourceMappingURL comment: the maps are not shipped, and
// browsers' developer tools report the missing file as an error.
//
// To upgrade, change the version in package.json (the seeder's, in
// containers/node/, should match), then run both commands again.

import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './build.js'

const dist = path.join(ROOT, 'node_modules', 'webtorrent', 'dist')
if (!fs.existsSync(dist)) {
    console.error(
        '[vendor] node_modules/webtorrent is missing; run `npm install` first.'
    )
    process.exit(1)
}

const { version } = JSON.parse(
    fs.readFileSync(path.join(dist, '..', 'package.json'), 'utf8')
)
const copies = [
    ['webtorrent.min.js', 'src/vendor/webtorrent.min.js'],
    ['sw.min.js', 'src/vendor/webtorrent-sw.js']
]
for (const [from, to] of copies) {
    const text = fs
        .readFileSync(path.join(dist, from), 'utf8')
        .replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n')
    fs.writeFileSync(path.join(ROOT, to), text)
    console.log(
        `[vendor] ${to} from webtorrent ${version} (${fs.statSync(path.join(ROOT, to)).size} bytes)`
    )
}
