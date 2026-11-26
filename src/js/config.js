// Site configuration, written into index.html by the build (scripts/build.js):
// where the stack's web seed and tracker live, which trackers to announce
// to, the radio's mirror, the radio stations, and the library peers whose
// private answers the extension takes (pinned public keys). The browser extension
// adds where the chat's relay is (scripts/extension.js); the site's is
// beside its pages.

const tag = typeof document !== 'undefined' && document.getElementById('config')

export const config = {
    seed: '',
    trackers: [],
    mirror: '',
    turn: '',
    stations: {},
    pinned: [],
    ...(tag ? JSON.parse(tag.textContent) : {})
}
