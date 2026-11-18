FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && apt-get clean
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/ ./server/
COPY migrations/ ./migrations/
USER node
CMD ["node", "server/worker-start.mjs"]
