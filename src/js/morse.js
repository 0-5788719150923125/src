// Morse code, and when each of its symbols sounds.

// Timing: a dot is one unit, a dash three; one unit between symbols,
// three between letters, seven between words.
export function schedule(message, unit = 0.16) {
    const times = []
    let now = 0
    for (const char of message) {
        const code = MORSE[char.toUpperCase()] || char
        now += char === ' ' ? unit * 7 : unit
        let lastSymbol = ''
        for (const symbol of code) {
            if (lastSymbol !== symbol) now += unit
            if (symbol === '.') now += unit
            else if (symbol === '-') now += unit * 3
            times.push(now)
            lastSymbol = symbol
        }
    }
    return times
}

export const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
    I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
    Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', W: '.--', X: '-..-', Y: '-.--',
    Z: '--..', ' ': ' '
}
