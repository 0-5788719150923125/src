// Waiting, and the date the banners print.

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// "YYYY/MM/DD hh:mm:ss", with a 12-hour clock.
export function formatDate(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0')
    return (
        `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
        `${pad(date.getHours() % 12 || 12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    )
}
