# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS node-codex
# Codex's native HTTP client needs the system trust store for ChatGPT TLS.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates bubblewrap ripgrep \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global @openai/codex@0.162.1

FROM node-codex AS development
WORKDIR /app
RUN npm install --global pnpm@9.12.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/standalone/package.json apps/standalone/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/embed/package.json packages/embed/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/src packages/contracts/src
# Normal server dependency, supplied from the sibling checkout as a named build context.
# Build kushibot on the host first; pnpm packages its declared dist/ files into the image.
COPY --from=kushibot package.json /kushibot/package.json
COPY --from=kushibot dist /kushibot/dist
RUN pnpm install --frozen-lockfile
# Agent sources are mounted at /plugins, so Node looks for dependencies at /node_modules.
RUN ln -s /app/node_modules /node_modules
COPY . .

FROM development AS frontend-build
RUN pnpm --filter @kushex/standalone build

FROM nginx:stable-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/apps/standalone/dist /usr/share/nginx/html
EXPOSE 80

FROM development AS backend-build
RUN pnpm --filter @kushex/server build     && pnpm --filter @kushex/server deploy --prod /opt/server

FROM node-codex AS backend
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=backend-build --chown=node:node /opt/server ./
RUN ln -s /app/node_modules /node_modules
RUN mkdir -p /var/lib/kushex/artifacts && chown -R node:node /var/lib/kushex
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
