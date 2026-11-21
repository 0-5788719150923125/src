// A station is a folder, seeded as one torrent. Its track list is read from
// the torrent's own file list, so nothing has to be kept in sync by hand:
//
//   01 - Leviathan Hunter.mp3            a track, titled "Leviathan Hunter"
//   01 - Leviathan Hunter - cover.png    an extra of that track, "cover"
//   01 - Leviathan Hunter - lyrics 1.jpg another, "lyrics 1"
//
// Audio files are tracks, in path order. Any other file whose name starts
// with a track's name and " - " belongs to that track.

export const AUDIO = /\.(mp3|ogg|oga|opus|flac|m4a|aac|wav)$/i

const base = (path) => path.split('/').pop()
const stem = (name) => name.replace(/\.[^.]+$/, '')

export function tracksOf(paths, { artist = 'Various Artists' } = {}) {
    const files = paths.map((path) => ({ path, name: base(path) }))
    const audio = files.filter((f) => AUDIO.test(f.name))
    const others = files.filter((f) => !AUDIO.test(f.name))
    return audio
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((track) => {
            const prefix = `${stem(track.name)} - `
            const extras = others
                .filter((f) => f.name.startsWith(prefix))
                .map((f) => ({ label: stem(f.name.slice(prefix.length)), path: f.path }))
                .sort((a, b) => (a.label < b.label ? -1 : 1))
            return {
                path: track.path,
                title: stem(track.name).replace(/^\d+\s*-\s*/, ''),
                artist,
                extras
            }
        })
}

// The web seed URL of a file inside a station's torrent.
export const seedUrl = (seed, path) =>
    `${seed}/radio/${path.split('/').map(encodeURIComponent).join('/')}`
