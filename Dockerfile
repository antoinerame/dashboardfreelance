FROM node:22-alpine AS build
WORKDIR /app
# Outils de compilation, au cas où better-sqlite3 n'aurait pas de binaire précompilé pour la plateforme.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data BACKUP_DIR=/backups TZ=Europe/Paris
RUN apk add --no-cache tzdata && mkdir -p /data /backups && chown node:node /data /backups
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/server/index.js"]
