// Site configuration, written into index.html by the build (scripts/build.js):
// where the stack's web seed and tracker live, which trackers to announce
// to, and the radio stations.

const tag = typeof document !== 'undefined' && document.getElementById('config')

export const config = {
    seed: 'http://localhost:8001',
    trackers: [],
    stations: {},
    ...(tag ? JSON.parse(tag.textContent) : {})
}
