# DESSERD site bot — production image (Telegram long-polling, always-on).
# The bot (bot/) reads template.html, styles.css, script.js, collage.js and
# build.js from the PROJECT ROOT, so the whole repo is copied in.
FROM node:20-alpine

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

WORKDIR /app/bot
CMD ["node", "bot.js"]
