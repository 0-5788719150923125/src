# One image, three programs: tracker.js, seed.js (the stack's peer) and
# webseed.js.
# Built from the repository root so it can take src/js/room.js, the chat
# protocol shared with the browser.
FROM docker.io/library/node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

ENV NODE_ENV=production
WORKDIR /app

COPY containers/node/package.json containers/node/package-lock.json ./
# Install scripts stay off, except node-datachannel's: it fetches the
# prebuilt binary that gives Node WebRTC, which is how browsers reach us.
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild node-datachannel \
    && npm cache clean --force \
    && mkdir -p /torrents && chown node:node /torrents

COPY containers/node/seed.js containers/node/tracker.js containers/node/webseed.js ./
COPY src/js/room.js ./room.js

USER node
CMD ["node", "seed.js"]
