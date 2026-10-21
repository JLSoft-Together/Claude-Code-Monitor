# syntax=docker/dockerfile:1
#
# Habblaud em container: escritório virtual dos agentes do Claude Code.
#
# Use `npm run docker:up` (scripts/docker-up.ts): ele detecta as contas do Claude Code no host,
# gera o docker-compose.override.yml com as montagens SOMENTE LEITURA de <conta>/projects,
# <conta>/sessions e ~/.habblaud/usage e sobe o serviço. Este Dockerfile sozinho não monta nada do host.

# ---------------------------------------------------------------------------------------------
# Estágio 1: compila o cliente (Vite) e empacota o servidor (esbuild) em dist/.
# ---------------------------------------------------------------------------------------------
# A imagem base fica presa pelo digest (o mesmo nos dois estágios), para o build ser reproduzível; o Dependabot
# (.github/dependabot.yml, ecossistema docker) troca a tag e o digest juntos quando sai versão nova.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder
WORKDIR /app

# Dependências primeiro: a camada fica em cache enquanto o lockfile não mudar.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Estágio 2: runtime enxuto. O servidor não tem dependências de runtime (só módulos node:*),
# então basta o dist/ e o package.json (nome, versão e "type": "module").
# ---------------------------------------------------------------------------------------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime

# HABBLAUD_USAGE_DIR: onde o docker-up monta (somente leitura) o uso capturado pelo tap de statusline.
ENV NODE_ENV=production \
    HABBLAUD_HOST=0.0.0.0 \
    HABBLAUD_PORT=4747 \
    HABBLAUD_IN_DOCKER=1 \
    HABBLAUD_DATA_DIR=/data \
    HABBLAUD_USAGE_DIR=/usage

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

# Estado do Habblaud (nomes persistidos). O volume nomeado herda este dono na primeira montagem.
RUN mkdir -p /data && chown node:node /data

# Usuário sem privilégios (já existe na imagem oficial do Node). O código fica com dono root,
# então o processo não consegue alterá-lo; só /data é gravável.
USER node

EXPOSE 4747
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4747/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "dist/server/index.js"]
