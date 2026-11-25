# One image, four programs: tracker.js, seed.js (the stack's peer),
# webseed.js, and peers.js (peers that remember a library for the ghost
# text's swarm memory: git repositories in the library service, test data
# in the peers service). git is for the library's sources.
# Built from the repository root so it can take src/js/room.js and
# src/js/memory.js, the protocols shared with the browser.
FROM docker.io/library/node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY containers/node/package.json containers/node/package-lock.json ./
# Install scripts stay off, except node-datachannel's: it fetches the
# prebuilt binary that gives Node WebRTC, which is how browsers reach us.
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild node-datachannel \
    && npm cache clean --force \
    && mkdir -p /torrents /data /cache && chown node:node /torrents /data /cache

COPY containers/node/seed.js containers/node/tracker.js containers/node/webseed.js containers/node/peers.js containers/node/sources.js containers/node/webrtc.js ./
COPY src/js/room.js src/js/memory.js ./

USER node
CMD ["node", "seed.js"]
