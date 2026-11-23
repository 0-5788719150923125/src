// The state that PEN@ROOT's ticker prints: a nested object, addressed by
// dotted keys ('radio.station'). It is never changed in place; each set or
// delete makes a new one.

const getIn = (obj, keys) => keys.reduce((node, key) => node?.[key], obj)

const setIn = (obj, [first, ...rest], value) => ({
    ...obj,
    [first]: rest.length ? setIn(obj[first] || {}, rest, value) : value
})

// Removes the key, then any object it leaves empty.
function deleteIn(obj, [first, ...rest]) {
    if (!(first in obj)) return obj
    const { [first]: inner, ...others } = obj
    if (!rest.length) return others
    const kept = deleteIn(inner, rest)
    return Object.keys(kept).length ? { ...others, [first]: kept } : others
}

export function createStore(initial = {}) {
    let data = initial
    return {
        get: (key) => getIn(data, key.split('.')),
        set: (key, value) => (data = setIn(data, key.split('.'), value)),
        delete: (key) => (data = deleteIn(data, key.split('.'))),
        snapshot: () => data
    }
}

export const state = createStore()

// The state as the ticker prints it: top-level keys in name order, so each
// keeps its place as others come and go. What is inside each stays in the
// order it was written (the radio's labels, the writer's numbers).
export const sortedKeys = (data) => Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
