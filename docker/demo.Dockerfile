# Demo Backend Dockerfile
# Express server with PocketPing SDK for development

FROM node:20-alpine

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Install tsx and pnpm globally for TypeScript execution
RUN npm install -g tsx pnpm

# ─────────────────────────────────────────────────────────────────
# Build SDK
# ─────────────────────────────────────────────────────────────────
COPY packages/sdk-node/package.json ./sdk-node/package.json
COPY packages/sdk-node/src ./sdk-node/src
COPY packages/sdk-node/tsconfig.json ./sdk-node/tsconfig.json

WORKDIR /app/sdk-node
RUN npm install && npm run build

# ─────────────────────────────────────────────────────────────────
# Build Widget
# ─────────────────────────────────────────────────────────────────
WORKDIR /app/widget
COPY packages/widget/package.json ./
COPY packages/widget/src ./src
COPY packages/widget/tsconfig.json ./
COPY packages/widget/tsup.config.ts ./

RUN npm install && npm run build

# ─────────────────────────────────────────────────────────────────
# Setup Demo Server
# ─────────────────────────────────────────────────────────────────
WORKDIR /app

# Copy demo server source
COPY docker/demo-server.ts ./src/server.ts

# Create package.json for demo
RUN echo '{"name":"pocketping-demo","type":"module","dependencies":{"@pocketping/sdk-node":"file:./sdk-node","dotenv":"^16.4.5","express":"^4.21.2"},"devDependencies":{"@types/express":"^5.0.2","@types/node":"^22.15.21"}}' > package.json

# Install demo dependencies
RUN npm install

# Create tsconfig
RUN echo '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","esModuleInterop":true,"strict":false,"skipLibCheck":true}}' > tsconfig.json

EXPOSE 3000

CMD ["tsx", "watch", "src/server.ts"]
