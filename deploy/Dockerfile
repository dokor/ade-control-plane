FROM node:22-bookworm-slim AS workspace

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN apt-get update \
  && apt-get install --no-install-recommends -y bash ca-certificates curl git openssh-client \
  && corepack enable \
  && corepack prepare pnpm@10.15.0 --activate \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY . .

FROM workspace AS dashboard-build
RUN pnpm --filter @ade-control-plane/dashboard build

FROM dashboard-build AS dashboard-runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 10001 ade-dashboard \
  && useradd --system --uid 10001 --gid ade-dashboard --home-dir /home/ade-dashboard --create-home ade-dashboard
WORKDIR /workspace/apps/dashboard
USER ade-dashboard
EXPOSE 3000
# Do not invoke pnpm/Corepack at runtime: its cache setup conflicts with the
# read-only production filesystem. The Next.js CLI is already installed.
CMD ["node", "node_modules/next/dist/bin/next", "start"]

FROM workspace AS worker-runtime
ENV NODE_ENV=production
ENV HOME=/home/ade-worker
ENV CODEX_HOME=/home/ade-worker/.codex
ENV V0_GIT_HOME=/home/ade-git
ENV PATH=/home/ade-worker/.local/bin:${PATH}
RUN apt-get update \
  && apt-get install --no-install-recommends -y bubblewrap \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10002 ade-worker \
  && useradd --system --uid 10002 --gid ade-worker --home-dir /home/ade-worker --create-home ade-worker \
  && mkdir -p /home/ade-worker/.codex /home/ade-git \
  && chown -R ade-worker:ade-worker /home/ade-worker
COPY deploy/bin/worker-entrypoint /usr/local/bin/ade-control-plane-worker
RUN chmod 0755 /usr/local/bin/ade-control-plane-worker
# Keep the ADE CLI immutable and outside the writable Codex home volume.
RUN npm install --global @alelouet/ai-delivery-engine@0.4.0 \
  && command -v ade
# The official installer selects the native Linux binary for the build
# architecture, including linux/arm64 when built on Raspberry Pi.
USER ade-worker
RUN curl -fsSL https://chatgpt.com/codex/install.sh | sh \
  && command -v codex
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/ade-control-plane-worker"]
CMD ["node_modules/.bin/tsx", "apps/worker/src/github/main.ts"]
