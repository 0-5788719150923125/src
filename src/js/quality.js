// What makes a line of chat read well, as rules (rules.js). They are
// adapted, for single lines, from the filters the large text corpora use
// (Gopher, C4). Two kinds: signs of care count for or against (ends in
// punctuation, starts with a capital, everyday words, ordinary word
// lengths); signs of noise only count against, and say nothing when absent
// (repetition, stuttering, shouting, symbols, links, keyboard mashing). The
// library (library.js) keeps lines by this score and weighs what it
// remembers by it.
//
// Weights were fitted to tests/quality.examples.json (2026-11-22, all 70
// right, also in cross-validation; the examples are hand-made and easy, so
// real chat will be harder). `node scripts/rules.js quality --fit` fits
// them again as the examples grow. Imports nothing; touches
// no DOM.

const words = (text) => text.split(/\s+/).filter(Boolean)
const letters = (word) => word.toLowerCase().replace(/[^a-z]/g, '')

// Words nearly every English sentence has.
const EVERYDAY = new Set(
    'the a an and or but to of in on at for with from is are was were be been it its i im you your he she we they them this that there what who how not no yes my me so if as do did does have has had can will would just about'.split(' ')
)

// Distinct three-letter pieces against all of them: low when a line keeps
// saying the same thing. (A stand-in for how well it would compress.)
function variety(text) {
    const pieces = []
    for (let i = 0; i + 3 <= text.length; i++) pieces.push(text.slice(i, i + 3))
    return pieces.length ? new Set(pieces).size / pieces.length : 1
}

export const quality = {
    name: 'quality',
    bias: -0.8,
    rules: [
        {
            name: 'ends-well',
            kind: 'care',
            about: 'ends in . ! or ? (a closing quote or bracket may follow)',
            weight: 2.7,
            test: (text) => (/[.!?]["')\]]?\s*$/.test(text) ? 1 : -1)
        },
        {
            name: 'capitalized',
            kind: 'care',
            about: 'starts with a capital letter or a number',
            weight: 1.5,
            test: (text) => (/^\s*["'(]?[A-Z0-9]/.test(text) ? 1 : -1)
        },
        {
            name: 'word-length',
            kind: 'care',
            about: 'words of ordinary length, three to eight letters on average',
            weight: 0.7,
            test: (text) => {
                const lengths = words(text).map((w) => letters(w).length).filter(Boolean)
                if (!lengths.length) return -1
                const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
                return mean >= 3 && mean <= 8 ? 1 : -1
            }
        },
        {
            name: 'everyday-words',
            kind: 'care',
            about: 'has words like the, and, to, you (in lines of four words or more)',
            weight: 0.5,
            test: (text) => {
                const ws = words(text).map(letters).filter(Boolean)
                if (ws.length < 4) return 0
                return ws.some((w) => EVERYDAY.has(w)) ? 1 : -1
            }
        },
        {
            name: 'mashed',
            kind: 'noise',
            about: 'words that do not look like words: no vowel, long runs of consonants',
            weight: 1.9,
            test: (text) => {
                const ws = words(text).map(letters).filter((w) => w.length >= 3)
                if (!ws.length) return 0
                const odd = ws.filter((w) => !/[aeiouy]/.test(w) || /[bcdfghjklmnpqrstvwxz]{5,}/.test(w) || w.length > 18).length / ws.length
                return odd > 0.25 ? -1 : odd > 0 ? -0.5 : 0
            }
        },
        {
            name: 'shouting',
            kind: 'noise',
            about: 'mostly capital letters',
            weight: 2.2,
            test: (text) => {
                const all = text.replace(/[^A-Za-z]/g, '')
                if (all.length < 8) return 0
                return all.replace(/[^A-Z]/g, '').length / all.length > 0.6 ? -1 : 0
            }
        },
        {
            name: 'repeats',
            kind: 'noise',
            about: 'the same words over and over',
            weight: 1.9,
            test: (text) => {
                const ws = words(text.toLowerCase())
                if (ws.length < 4) return 0
                const unique = new Set(ws).size / ws.length
                return unique < 0.5 ? -1 : unique < 0.75 ? -0.5 : 0
            }
        },
        {
            name: 'stutter',
            kind: 'noise',
            about: 'runs of one character, like !!!! or aaaa',
            weight: 2,
            test: (text) => (/(.)\1{3,}/.test(text) ? -1 : 0)
        },
        {
            name: 'samey',
            kind: 'noise',
            about: 'keeps saying the same thing (lines of 20 characters or more)',
            weight: 0.9,
            test: (text) => (text.length >= 20 && variety(text.toLowerCase()) < 0.6 ? -1 : 0)
        },
        {
            name: 'symbols',
            kind: 'noise',
            about: 'symbols such as # $ % * @',
            weight: 1.4,
            test: (text) => (text.replace(/[A-Za-z0-9\s.,!?'"()\-:;]/g, '').length / (text.length || 1) > 0.05 ? -1 : 0)
        },
        {
            name: 'links',
            kind: 'noise',
            about: 'web addresses',
            weight: 1.4,
            test: (text) => (/https?:\/\/|www\.|\.(com|net|org|io|xyz)\b/i.test(text) ? -1 : 0)
        },
        {
            name: 'says-something',
            kind: 'care',
            about: 'three words or more',
            weight: 0.4,
            test: (text) => (words(text).length >= 3 ? 1 : -1)
        }
    ]
}
