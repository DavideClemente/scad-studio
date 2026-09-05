# syntax=docker/dockerfile:1

# The OpenSCAD engine is a ~9MB wasm binary that `npm run setup` fetches from
# files.openscad.org, and it is git-ignored rather than committed. Baking it into
# the image here is the point: the container is then self-contained and the
# download happens once at build, not on someone's first visit.
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change does not re-install them.
COPY package.json package-lock.json ./
RUN npm ci

# The engine download gets its own layer, ahead of the source copy. Folded in with
# the build it would re-fetch ~10MB from files.openscad.org on every source change,
# for a file that changes about once a year.
COPY scripts/fetch-openscad-wasm.mjs scripts/
RUN npm run setup

COPY . .
RUN npm run build && node scripts/precompress.mjs

FROM caddy:2-alpine AS runtime
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080

# Static files only: every render runs in the visitor's browser, so this process
# never computes anything and holds no per-user state. It answers /index.html to
# prove it is alive, since there is no application health to report beyond that.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
