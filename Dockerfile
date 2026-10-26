FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production PORT=18081 BIND_HOST=0.0.0.0 DB_PATH=/app/data/workout.sqlite BACKUP_DIR=/app/backups TZ=America/Chicago
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY domain ./domain
COPY scripts/healthcheck.js scripts/backup.js ./scripts/
COPY import/apply.js import/exercisedb.js import/exercise-cli.js ./import/
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
EXPOSE 18081
CMD ["node","server/main.js"]
