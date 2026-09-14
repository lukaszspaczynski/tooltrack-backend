FROM node:22.17.0-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 app

# .dockerignore keeps .git out of the build context, so nothing in here can ask
# git what commit this is. The build passes it in as this arg and the server
# reports it on /api/version. A plain `docker build` still succeeds and says
# 'unknown'.
ARG TOOLTRACK_COMMIT=unknown
ENV TOOLTRACK_COMMIT=$TOOLTRACK_COMMIT

COPY --from=deps --chown=app:nodejs /app/node_modules ./node_modules
COPY --chown=app:nodejs package.json ./package.json
COPY --chown=app:nodejs tsconfig.json ./tsconfig.json
COPY --chown=app:nodejs src ./src
# Not code, but read at runtime all the same: the fonts a label is drawn with,
# and the CA certificate one import source neglects to send. See the READMEs
# next to each. The start script names them by a path relative to WORKDIR.
COPY --chown=app:nodejs assets ./assets

USER app
EXPOSE 8080
ENV PORT=8080 HOSTNAME=0.0.0.0

CMD ["npm", "start"]
