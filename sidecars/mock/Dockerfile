FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
COPY types/ types/
COPY packages/ packages/
RUN npm ci && npx tsc -b packages/sidecar-mock
EXPOSE 4100
CMD ["node", "packages/sidecar-mock/dist/src/main.js"]
