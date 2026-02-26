FROM oven/bun:1 AS base
WORKDIR /app

# Install curl for ECS health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Persistent data dir
RUN mkdir -p /data

ENV PORT=3000
ENV DB_PATH=/data/eto-challenge.db
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
