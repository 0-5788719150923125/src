// Randomness: Math.random where any answer will do, and a seeded draw where
// the same input must give the same answer on every device (daemon names,
// sigils).

export const pick = (array) => array[Math.floor(Math.random() * array.length)]

// A shuffled copy (Fisher-Yates), the original left alone; random(i) gives
// draw i, in [0, 1).
function shuffled(array, random) {
    const copy = [...array]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random(i) * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

export const shuffle = (array) => shuffled(array, Math.random)

// A deterministic number in [0, 1) from a string: the first draw of
// xoshiro128** seeded by xmur3. Only the first seed word reaches that draw,
// so only one is computed.
export function seededRandom(str) {
    let h = 1779033703 ^ str.length
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    const a = (h ^= h >>> 16) >>> 0
    const r = (((a * 5) << 7) | ((a * 5) >>> 25)) * 9
    return (r >>> 0) / 4294967296
}

export const seededPick = (array, seed) =>
    array[Math.floor(seededRandom(seed) * array.length)]

// A shuffled copy that every device makes alike from the same seed: each
// draw is seededRandom of the seed and the draw's number.
export const seededShuffle = (array, seed) =>
    shuffled(array, (i) => seededRandom(`${seed}:${i}`))
