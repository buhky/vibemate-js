# ---- dependencies (build tools live only in this stage) ----
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp in its own venv, owned by the runtime user so it can self-update at start
RUN python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir --upgrade pip yt-dlp \
    && chown -R node:node /opt/ytdlp

ENV NODE_ENV=production \
    YTDLP_PATH=/opt/ytdlp/bin/yt-dlp \
    FFMPEG_PATH=ffmpeg \
    DATA_DIR=/app/data \
    TMP_DIR=/app/.vibemate_tmp

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p data .vibemate_tmp && chown -R node:node /app

USER node

# Refresh yt-dlp on each start so YouTube extractor fixes land without a rebuild
CMD ["sh", "-c", "/opt/ytdlp/bin/pip install -q --no-cache-dir --upgrade yt-dlp || true; exec node src/index.js"]
