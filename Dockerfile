FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat wget

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3900

ENV PORT=3900
ENV NODE_ENV=production

CMD ["node", "server.js"]
