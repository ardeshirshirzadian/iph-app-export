FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
# Registry override for constrained build hosts. Default is official npm.
# This VPS (37.152.190.227) blocks the TLS SNI handshake to registry.npmjs.org,
# so builds *here* must pass:  --build-arg NPM_REGISTRY=https://mirrors.tencent.com/npm/
# (verified reachable 2026-09-09). US relay / CI build with the default and are unaffected.
# See frontend/BUILD.md.
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install --registry=${NPM_REGISTRY}
COPY . .
ENV NODE_ENV=production
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
