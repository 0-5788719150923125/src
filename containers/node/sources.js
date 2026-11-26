// The library's sources: git repositories (GitHub, GitLab, any host git can
// clone over https), read for their prose and code. The peers remember what
// they hold and answer the ghost text's memory questions from it (peers.js).
//
//   PEER_SOURCES  git URLs, separated by commas, spaces or line breaks; a
//                 URL may end in #branch (else the default branch)
//
// Each is cloned shallow, one commit, into DATA_DIR/sources, and brought up
// to date in place on each refresh. git never prompts (a private or missing
// repository fails, and is skipped with a warning), and nothing in a
// repository runs: clones run no hooks.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// [{ url, ref }] from the setting.
export function parseSources(value = '') {
    return value
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
            const [url, ref = ''] = entry.split('#')
            return { url, ref }
        })
}

// A folder name for a repository: host and path, plain.
export const slug = (url) =>
    url
        .replace(/^[a-z+]+:\/\//i, '')
        .replace(/^[^@/]*@/, '')
        .replace(/\.git$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()

const git = (args, cwd) =>
    run('git', args, {
        cwd,
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_LFS_SKIP_SMUDGE: '1'
        }
    })

// Clone the repository, or bring the clone up to date. Returns its folder.
export async function fetchSource({ url, ref }, root) {
    const dir = path.join(root, slug(url))
    if (fs.existsSync(path.join(dir, '.git'))) {
        await git(['fetch', '--depth', '1', 'origin', ref || 'HEAD'], dir)
        await git(['reset', '--hard', '--quiet', 'FETCH_HEAD'], dir)
    } else {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.mkdirSync(root, { recursive: true })
        await git(
            [
                'clone',
                '--depth',
                '1',
                '--single-branch',
                '--quiet',
                ...(ref ? ['--branch', ref] : []),
                url,
                dir
            ],
            root
        )
    }
    return dir
}

// What is read: prose, then code. Everything else is left out: binaries,
// data, and the files tools write rather than people.
const PROSE = /\.(md|markdown|mdx|txt|rst|adoc|asciidoc|org|tex)$/i
const CODE =
    /\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|kts|scala|c|h|cc|cpp|hpp|cxx|cs|fs|swift|m|php|pl|lua|r|jl|ex|exs|erl|hs|ml|clj|dart|zig|nim|sh|bash|zsh|fish|ps1|sql|html|htm|css|scss|sass|less|vue|svelte|astro|yaml|yml|toml|ini|cfg|graphql|proto|tf|nix|dockerfile|makefile|cmake|gradle)$/i
const BARE =
    /^(readme|license|licence|copying|authors|contributing|changelog|changes|notice|dockerfile|makefile|justfile)$/i
const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'vendor',
    'third_party',
    'dist',
    'build',
    'out',
    'target',
    'coverage',
    '__pycache__',
    '.venv',
    'venv',
    '.next',
    '.cache'
])
const SKIP_FILES =
    /(\.min\.(js|css)|\.map|\.lock|-lock\.(json|yaml)|^go\.sum|\.snap)$/i
export const MAX_FILE = 256 * 1024

// The text of one clone: README first, then other prose, then code, each
// group in path order, files joined by blank lines.
export function collect(dir) {
    const files = []
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name)
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.'))
                    walk(full)
                continue
            }
            if (!entry.isFile() || SKIP_FILES.test(entry.name)) continue
            const stem = entry.name.replace(/\.[^.]+$/, '')
            const prose =
                PROSE.test(entry.name) ||
                (BARE.test(stem) && !CODE.test(entry.name))
            if (!prose && !CODE.test(entry.name) && !BARE.test(entry.name))
                continue
            const size = fs.statSync(full).size
            if (!size || size > MAX_FILE) continue
            files.push({
                path: path.relative(dir, full),
                full,
                prose,
                readme:
                    /^readme/i.test(entry.name) && path.dirname(full) === dir
            })
        }
    }
    walk(dir)
    const rank = (f) => (f.readme ? 0 : f.prose ? 1 : 2)
    files.sort(
        (a, b) =>
            rank(a) - rank(b) ||
            (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    )
    const texts = []
    for (const file of files) {
        const buf = fs.readFileSync(file.full)
        if (buf.subarray(0, 8000).includes(0)) continue // binary
        texts.push(buf.toString('utf8'))
    }
    return texts.join('\n\n')
}

// Every source, fetched and read; one that fails is skipped. `log` reports.
export async function readSources(sources, root, log = console.log) {
    const texts = []
    for (const source of sources) {
        try {
            const dir = await fetchSource(source, root)
            const text = collect(dir)
            log(
                `source ${source.url}${source.ref ? `#${source.ref}` : ''}: ${(text.length / 1e6).toFixed(2)}M characters`
            )
            texts.push(text)
        } catch (err) {
            log(
                `source ${source.url}: skipped (${(err.stderr || err.message || String(err)).trim().split('\n').pop()})`
            )
        }
    }
    return texts.join('\n\n')
}
