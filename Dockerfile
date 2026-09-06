# Hidook Site Builder — production image (Node bot/server: browser builder host
# + Telegram draft intake, long-polling, always-on).
# The bot (bot/) reads template.html, styles.css, script.js, collage.js and
# build.js from the PROJECT ROOT, so the whole repo is copied in.
#
# Pinned to 22.20.0, not node:20-alpine: the native calendar (bot/calendar-native/db.js)
# requires the built-in `node:sqlite` module, which does not exist at all on Node 20
# (CAL-001 audit finding, 2026-09-06). Verified empirically on this exact patch:
#   node -e "require('node:sqlite')" succeeds with no flag, and a functional
#   CREATE TABLE round-trip works, on 22.20.0-alpine's Node build. Node 22.11.0 and
#   23.1.0 both still throw "No such built-in module: node:sqlite" without
#   --experimental-sqlite, so the base image is pinned to this exact version rather
#   than a floating `node:22-alpine` tag. NODE_OPTIONS below is kept as a defensive
#   belt-and-suspenders in case a future rebuild floats to an older 22.x patch.
FROM node:22.20.0-alpine

WORKDIR /app

# Install bot dependencies first (better layer caching)
COPY bot/package.json bot/package-lock.json ./bot/
RUN cd bot && npm ci --omit=dev

# Cloudflare Pages deploys (bot/deploy-cloudflare.js) shell out to the wrangler CLI
# (Direct Upload — the raw HTTP flow needs BLAKE3 hashing that node:crypto lacks).
RUN npm install -g wrangler@4

# Copy the rest of the project (template + assets + build pipeline)
COPY . .

# Browser builder assets are gitignored; bake them into the image so /app/ boots.
RUN node scripts/build-builder.js

# Persisted runtime state (sessions, site-map) → mount a volume here on Railway
ENV DATA_DIR=/data
RUN mkdir -p /data

# node:sqlite is unflagged on 22.20.0 (see FROM comment above), but this is set
# explicitly so the native calendar keeps working even if the base image is ever
# floated back to an older 22.x patch. Applies to any entrypoint (web.js, bot.js).
ENV NODE_OPTIONS=--experimental-sqlite

WORKDIR /app/bot
# Web-only by default: bot.js exits at boot without TELEGRAM_BOT_TOKEN, which
# would crash-loop a web deployment. Override the start command with
# `node bot.js` to add Telegram draft intake (one replica — one poller/token).
CMD ["node", "web.js"]
