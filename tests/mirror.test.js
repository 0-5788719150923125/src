import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mirrorUrl, siteConfig } from '../scripts/build.js'
import { mirrorSettings, signV4 } from '../scripts/mirror.js'
import {
    makeTorrent,
    readTorrent,
    stationFolder,
    verifyFolder
} from '../scripts/torrent.js'

// A minimal bencoder, to make .torrent files to read back.
const benc = (v) =>
    Buffer.isBuffer(v)
        ? Buffer.concat([Buffer.from(`${v.length}:`), v])
        : typeof v === 'string'
          ? benc(Buffer.from(v))
          : typeof v === 'number'
            ? Buffer.from(`i${v}e`)
            : Array.isArray(v)
              ? Buffer.concat([
                    Buffer.from('l'),
                    ...v.map(benc),
                    Buffer.from('e')
                ])
              : Buffer.concat([
                    Buffer.from('d'),
                    ...Object.keys(v)
                        .sort()
                        .flatMap((k) => [benc(k), benc(v[k])]),
                    Buffer.from('e')
                ])

// A station folder and its .torrent, with pieces smaller than a file so
// pieces cross file boundaries.
function station({ pieceLength = 1024, sorted = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-mirror-'))
    const files = {
        '01 - One.mp3': crypto.randomBytes(5000),
        '01 - One - cover.png': crypto.randomBytes(1234),
        'sub/02 - Two.mp3': crypto.randomBytes(777)
    }
    const names = sorted ? Object.keys(files).sort() : Object.keys(files)
    for (const name of names) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
        fs.writeFileSync(path.join(dir, name), files[name])
    }
    const all = Buffer.concat(names.map((n) => files[n]))
    const pieces = []
    for (let i = 0; i < all.length; i += pieceLength)
        pieces.push(
            crypto
                .createHash('sha1')
                .update(all.subarray(i, i + pieceLength))
                .digest()
        )
    const info = {
        name: '59',
        'piece length': pieceLength,
        pieces: Buffer.concat(pieces),
        files: names.map((n) => ({
            length: files[n].length,
            path: n.split('/')
        }))
    }
    const buf = benc({
        announce: 'wss://example.org',
        comment: '4:infod is not here',
        info
    })
    return {
        dir,
        buf,
        infoHash: crypto.createHash('sha1').update(benc(info)).digest('hex')
    }
}

test('a .torrent reads back with its info hash and file offsets', () => {
    const { buf, infoHash } = station()
    const torrent = readTorrent(buf)
    assert.equal(torrent.name, '59')
    assert.equal(torrent.infoHash, infoHash)
    assert.deepEqual(
        torrent.files.map((f) => [f.path, f.inner, f.offset]),
        [
            ['59/01 - One.mp3', '01 - One.mp3', 0],
            ['59/01 - One - cover.png', '01 - One - cover.png', 5000],
            ['59/sub/02 - Two.mp3', 'sub/02 - Two.mp3', 6234]
        ]
    )
})

test('a folder verifies against its .torrent, and one changed byte fails it', async () => {
    const { dir, buf } = station()
    const torrent = readTorrent(buf)
    await verifyFolder(dir, torrent)
    const file = path.join(dir, '01 - One - cover.png')
    const bytes = fs.readFileSync(file)
    bytes[100] ^= 1
    fs.writeFileSync(file, bytes)
    await assert.rejects(
        verifyFolder(dir, torrent),
        /cover\.png: piece 4 differs/
    )
    fs.writeFileSync(file, bytes.subarray(1))
    await assert.rejects(verifyFolder(dir, torrent), /1233 bytes here, 1234/)
})

test("Signature Version 4 matches AWS's GET Object example", () => {
    const empty =
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const authorization = signV4({
        method: 'GET',
        path: '/test.txt',
        headers: {
            host: 'examplebucket.s3.amazonaws.com',
            range: 'bytes=0-9',
            'x-amz-content-sha256': empty,
            'x-amz-date': '20130524T000000Z'
        },
        payloadHash: empty,
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        date: new Date('2013-05-24T00:00:00Z')
    })
    assert.equal(
        authorization,
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
            'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
})

test('the mirror needs a bucket and a domain, and reaches the site config', () => {
    const r2 = {
        CLOUDFLARE_R2_BUCKET: 'src-radio',
        CLOUDFLARE_R2_DOMAIN: 'radio.src.eco'
    }
    assert.equal(mirrorSettings({ CLOUDFLARE_R2_BUCKET: 'src-radio' }), null)
    assert.deepEqual(mirrorSettings(r2), {
        bucket: 'src-radio',
        domain: 'radio.src.eco'
    })
    assert.equal(mirrorUrl({}), '')
    assert.equal(mirrorUrl(r2), 'https://radio.src.eco')
    assert.equal(
        mirrorUrl({ ...r2, SRC_MIRROR_URL: 'http://localhost:8001/radio/' }),
        'http://localhost:8001/radio'
    )
    assert.equal(
        siteConfig({}, r2, { deploy: true }).mirror,
        'https://radio.src.eco'
    )
    assert.equal(
        siteConfig(
            {},
            { SRC_MIRROR_URL: 'http://localhost:8001/radio' },
            { deploy: true }
        ).mirror,
        ''
    )
    assert.equal(stationFolder('88.5', { STATION_88_5: '/music' }), '/music')
})

test("a folder's .torrent made here has the info hash of the one it was read back from", async () => {
    const { dir, buf } = station({ pieceLength: 16384, sorted: true })
    const made = readTorrent(
        await makeTorrent(dir, '59', ['wss://example.org'])
    )
    assert.equal(made.infoHash, readTorrent(buf).infoHash)
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk')
    assert.equal(
        readTorrent(await makeTorrent(dir, '59')).infoHash,
        made.infoHash
    )
})

test("an MP3's length comes from its frames, or its Xing header", async () => {
    const { mp3Duration } = await import('../scripts/mp3.js')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-mp3-'))
    // MPEG-1 layer III, 128 kbit/s, 44.1 kHz, stereo: 417-byte frames of
    // 1152 samples. 100 of them are 2.612 s.
    const header = Buffer.from([0xff, 0xfb, 0x90, 0x00])
    const oneFrame = Buffer.concat([header, Buffer.alloc(413)])
    const id3 = Buffer.concat([
        Buffer.from('ID3'),
        Buffer.from([3, 0, 0, 0, 0, 0, 20]),
        Buffer.alloc(20)
    ])
    fs.writeFileSync(
        path.join(dir, 'cbr.mp3'),
        Buffer.concat([id3, ...Array(100).fill(oneFrame)])
    )
    assert.equal(
        mp3Duration(path.join(dir, 'cbr.mp3')).toFixed(3),
        ((100 * 1152) / 44100).toFixed(3)
    )
    // A Xing header saying 5000 frames is believed without counting.
    const xing = Buffer.alloc(417)
    header.copy(xing)
    xing.write('Xing', 4 + 32, 'latin1')
    xing.writeUInt32BE(1, 4 + 32 + 4)
    xing.writeUInt32BE(5000, 4 + 32 + 8)
    fs.writeFileSync(
        path.join(dir, 'vbr.mp3'),
        Buffer.concat([xing, ...Array(3).fill(oneFrame)])
    )
    assert.equal(
        mp3Duration(path.join(dir, 'vbr.mp3')).toFixed(3),
        ((5000 * 1152) / 44100).toFixed(3)
    )
    fs.writeFileSync(path.join(dir, 'not.mp3'), 'not audio at all')
    assert.equal(mp3Duration(path.join(dir, 'not.mp3')), null)
    fs.rmSync(dir, { recursive: true })
})
