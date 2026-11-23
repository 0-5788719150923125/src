// How long an MP3 is, in seconds, read from the file alone. The radio
// schedules its stations by these (src/js/station.js `onAir`), so every
// listener hears the same song at the same moment.
//
// An encoder that wrote a Xing/Info or VBRI header says how many frames the
// file holds; otherwise every frame is counted, which reads the whole file.

import fs from 'node:fs'

const BITRATES = {
    // [version][layer] -> kbit/s by index; version 1 is MPEG-1, 2 is 2 and 2.5
    1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
    2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] }
}
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } // by version bits

// The frame header at `at`, or null.
function frame(buf, at) {
    if (at + 4 > buf.length || buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) return null
    const versionBits = (buf[at + 1] >> 3) & 3 // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const layerBits = (buf[at + 1] >> 1) & 3 // 3: layer I, 2: II, 1: III
    const bitrateIndex = buf[at + 2] >> 4
    const rateIndex = (buf[at + 2] >> 2) & 3
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null
    const version = versionBits === 3 ? 1 : 2
    const layer = 4 - layerBits
    const bitrate = BITRATES[version][layer][bitrateIndex] * 1000
    const sampleRate = RATES[versionBits][rateIndex]
    const padding = (buf[at + 2] >> 1) & 1
    const mono = buf[at + 3] >> 6 === 3
    const samples = layer === 1 ? 384 : layer === 3 && version === 2 ? 576 : 1152
    const length = layer === 1 ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4 : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding
    return { version, layer, sampleRate, samples, mono, length }
}

// Where the audio starts: after an ID3v2 tag, if there is one.
function audioStart(buf) {
    if (buf.toString('latin1', 0, 3) !== 'ID3') return 0
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
    return 10 + size + (buf[5] & 0x10 ? 10 : 0)
}

// The first frame at or after `from` that another frame follows, so a stray
// 0xFF byte in the data is not taken for one.
function firstFrame(buf, from) {
    for (let at = from; at < buf.length - 4; at++) {
        const head = frame(buf, at)
        if (head && frame(buf, at + head.length)) return { at, head }
    }
    return null
}

export function mp3Duration(file) {
    const buf = fs.readFileSync(file)
    const found = firstFrame(buf, audioStart(buf))
    if (!found) return null
    const { at, head } = found
    // Xing/Info: after the side information, which depends on the version
    // and the channels.
    const side = head.version === 1 ? (head.mono ? 17 : 32) : head.mono ? 9 : 17
    const xing = at + 4 + side
    const tag = buf.toString('latin1', xing, xing + 4)
    if ((tag === 'Xing' || tag === 'Info') && buf.readUInt32BE(xing + 4) & 1) {
        return (buf.readUInt32BE(xing + 8) * head.samples) / head.sampleRate
    }
    if (buf.toString('latin1', at + 36, at + 40) === 'VBRI') {
        return (buf.readUInt32BE(at + 36 + 14) * head.samples) / head.sampleRate
    }
    // No header: count the frames.
    let frames = 0
    let seconds = 0
    for (let pos = at; ; ) {
        const next = frame(buf, pos)
        if (!next) break
        frames++
        seconds += next.samples / next.sampleRate
        pos += next.length
    }
    return frames ? seconds : null
}
