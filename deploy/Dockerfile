ARG ADE_VERSION=0.7.0

FROM node:22-bookworm-slim AS workspace

ARG ADE_VERSION
ENV ADE_RUNTIME_VERSION=${ADE_VERSION}

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN apt-get update \
  && apt-get install --no-install-recommends -y bash ca-certificates curl git openssh-client \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/ade-client/package.json ./packages/ade-client/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/github/package.json ./packages/github/package.json
COPY packages/host-runner/package.json ./packages/host-runner/package.json
COPY packages/quota/package.json ./packages/quota/package.json
COPY packages/runner-protocol/package.json ./packages/runner-protocol/package.json
RUN --mount=type=cache,id=ade-control-plane-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile
COPY . .

FROM workspace AS dashboard-build
RUN pnpm --filter @ade-control-plane/dashboard build

FROM node:22-bookworm-slim AS dashboard-runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 10001 ade-dashboard \
  && useradd --system --uid 10001 --gid ade-dashboard --home-dir /home/ade-dashboard --create-home ade-dashboard
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY --from=dashboard-build /workspace/apps/dashboard/.next/standalone ./
COPY --from=dashboard-build /workspace/apps/dashboard/.next/static ./.next/static
USER ade-dashboard
EXPOSE 3000
CMD ["node", "server.js"]

FROM workspace AS worker-dependencies
RUN pnpm --filter @ade-control-plane/worker deploy --prod --legacy /worker-deploy

FROM node:22-bookworm-slim AS worker-runtime
ARG ADE_VERSION
ENV NODE_ENV=production
ENV HOME=/home/ade-worker
ENV CODEX_HOME=/home/ade-worker/.codex
ENV V0_GIT_HOME=/home/ade-git
ENV PATH=/home/ade-worker/.local/bin:${PATH}
RUN apt-get update \
  && apt-get install --no-install-recommends -y bash ca-certificates curl git openssh-client bubblewrap \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10002 ade-worker \
  && useradd --system --uid 10002 --gid ade-worker --home-dir /home/ade-worker --create-home ade-worker \
  && mkdir -p /home/ade-worker/.codex /home/ade-git \
  && chown -R ade-worker:ade-worker /home/ade-worker
WORKDIR /workspace
COPY --from=worker-dependencies /worker-deploy/ ./
COPY apps/worker/src ./apps/worker/src
COPY deploy/bin/worker-entrypoint /usr/local/bin/ade-control-plane-worker
RUN chmod 0755 /usr/local/bin/ade-control-plane-worker
# Keep the ADE CLI immutable and outside the writable Codex home volume.
RUN npm install --global "@alelouet/ai-delivery-engine@${ADE_VERSION}" \
  && command -v ade
# The official installer selects the native Linux binary for the build
# architecture, including linux/arm64 when built on Raspberry Pi.
USER ade-worker
RUN curl -fsSL https://chatgpt.com/codex/install.sh | sh \
  && command -v codex
ENTRYPOINT ["/usr/local/bin/ade-control-plane-worker"]
CMD ["node_modules/.bin/tsx", "apps/worker/src/github/main.ts"]
