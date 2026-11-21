# syntax=docker/dockerfile:1

FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY server.ts ./

RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node server.ts ./server.ts
COPY --chown=node:node server ./server
COPY --chown=node:node src/types ./src/types

USER node

EXPOSE 8080

CMD ["node", "server.ts"]
