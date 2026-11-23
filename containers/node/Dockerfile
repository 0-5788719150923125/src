# One image, four programs: tracker.js, seed.js (the stack's peer),
# webseed.js, and peers.js (test peers that remember a library, for the
# ghost text's swarm memory).
# Built from the repository root so it can take src/js/room.js and
# src/js/memory.js, the protocols shared with the browser.
FROM docker.io/library/node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

ENV NODE_ENV=production
WORKDIR /app

COPY containers/node/package.json containers/node/package-lock.json ./
# Install scripts stay off, except node-datachannel's: it fetches the
# prebuilt binary that gives Node WebRTC, which is how browsers reach us.
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild node-datachannel \
    && npm cache clean --force \
    && mkdir -p /torrents /data && chown node:node /torrents /data

COPY containers/node/seed.js containers/node/tracker.js containers/node/webseed.js containers/node/peers.js ./
COPY src/js/room.js src/js/memory.js ./

USER node
CMD ["node", "seed.js"]
