// Site configuration, written into index.html by the build (scripts/build.js):
// where the stack's web seed and tracker live, which trackers to announce
// to, the radio's mirror, and the radio stations.

const tag = typeof document !== 'undefined' && document.getElementById('config')

export const config = {
    seed: '',
    trackers: [],
    mirror: '',
    stations: {},
    ...(tag ? JSON.parse(tag.textContent) : {})
}
