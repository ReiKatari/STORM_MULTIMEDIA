FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat wget

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3900

ENV PORT=3900
ENV NODE_ENV=production

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3900/api/health || exit 1

CMD ["node", "server.js"]
