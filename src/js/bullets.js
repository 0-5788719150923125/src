// The void: whenever a peer connects, a bullet crosses the canvas behind the
// terminal. Red ones fade out; blue ones fade in.

const canvas = document.getElementById('void')
const ctx = canvas.getContext('2d')
const bullets = []

function randomPointNearCenter() {
    const direction = Math.random() * Math.PI * 2
    const distance = Math.random() * 300 + 100
    return {
        x: canvas.width / 2 + Math.cos(direction) * distance,
        y: canvas.height / 2 + Math.sin(direction) * distance
    }
}

export function createBullet() {
    const start = randomPointNearCenter()
    const endX = Math.random() * canvas.width
    const endY = Math.random() * canvas.height
    const color = Math.random() < 0.5 ? 'red' : 'blue'
    bullets.push({
        x: start.x,
        y: start.y,
        angle: Math.atan2(endY - start.y, endX - start.x),
        speed: Math.random() * 5 + 2,
        color,
        opacity: color === 'red' ? 1 : 0
    })
}

function updateBullets() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i]
        bullet.x += Math.cos(bullet.angle) * bullet.speed
        bullet.y += Math.sin(bullet.angle) * bullet.speed
        bullet.opacity += bullet.color === 'red' ? -0.01 : 0.01
        ctx.beginPath()
        ctx.arc(bullet.x, bullet.y, 2, 0, 2 * Math.PI, false)
        ctx.fillStyle = `rgba(${bullet.color === 'red' ? '255, 0, 0,' : '0, 0, 255,'} ${bullet.opacity})`
        ctx.fill()
        if (bullet.opacity < 0 || bullet.opacity > 1) bullets.splice(i, 1)
    }
    requestAnimationFrame(updateBullets)
}

function resizeCanvas() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
}

window.addEventListener('resize', resizeCanvas)
resizeCanvas()
updateBullets()
