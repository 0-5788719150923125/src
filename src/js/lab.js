// The lab: a gif, an error, and then a message tapped out in Morse code.

import { schedule } from './morse.js'
import { say } from './print.js'
import { t } from './text.js'
import { delay } from './time.js'

// /lab
export async function lab() {
    say({ html: '<br><img src="assets/CORE.gif">' })
    await delay(6000)
    say(t('lab.error'))
    await delay(2000)
    play(t('lab.morse'))
}

// A small triangle-wave synth: A4, a sixteenth note per symbol (0.125 s at
// 120 bpm), a quick attack, a short decay, and a one-second release that the
// next note cuts off.
function play(message) {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = 440
    gain.gain.value = 0
    osc.connect(gain).connect(ctx.destination)
    const start = ctx.currentTime + 0.1
    const times = schedule(message).map((time) => start + time)
    const peak = 0.4
    times.forEach((at, k) => {
        const next = times[k + 1] ?? at + 1.2
        const g = gain.gain
        g.setValueAtTime(0, at)
        g.linearRampToValueAtTime(peak, at + 0.005)
        g.linearRampToValueAtTime(peak * 0.3, at + 0.105)
        g.setValueAtTime(peak * 0.3, at + 0.125)
        g.exponentialRampToValueAtTime(0.0001, Math.min(at + 1.125, next - 0.001))
    })
    osc.start(start)
    osc.stop(times.at(-1) + 1.3)
}
