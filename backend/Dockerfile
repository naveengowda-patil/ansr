# syntax=docker/dockerfile:1
# Blueprint §8.3: multi-stage build, prod deps only at runtime, non-root user.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Optional: `docker build --target test backend` runs typecheck + tests on Node 24.
FROM deps AS test
COPY . .
RUN npm run typecheck && npm test

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
