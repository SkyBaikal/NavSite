# NavSite 后端镜像（前端构建产物由 build 阶段生成，最终镜像单容器）
FROM node:22-alpine AS build
WORKDIR /build
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml* ./frontend/
RUN cd frontend && echo "onlyBuiltDependencies:" > pnpm-workspace.yaml && echo "  - esbuild" >> pnpm-workspace.yaml && echo "dangerouslyAllowAllBuilds: true" >> pnpm-workspace.yaml && pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false 2>&1 | tail -5 || pnpm install --no-frozen-lockfile
COPY frontend/ ./frontend/
RUN cd frontend && npx vite build

FROM node:22-alpine
RUN sed -i 's#https://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories
WORKDIR /app
RUN apk add --no-cache python3 make g++ && corepack enable
COPY backend/package.json backend/pnpm-lock.yaml* ./
RUN echo "onlyBuiltDependencies:" > pnpm-workspace.yaml && echo "  - esbuild" >> pnpm-workspace.yaml && echo "  - better-sqlite3" >> pnpm-workspace.yaml && echo "dangerouslyAllowAllBuilds: true" >> pnpm-workspace.yaml && pnpm install --no-frozen-lockfile
# 重建原生模块（musl 兼容：删掉 glibc prebuild，强制 node-gyp 源码编译）
RUN cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3 && rm -rf build prebuilds && npm run build-release && node -e "new (require('.'))(':memory:'); console.log('better-sqlite3 source-build OK')"
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/db ./backend/db
COPY backend/public ./backend/public
RUN mv node_modules backend/node_modules && mv package.json backend/ && mv pnpm-lock.yaml backend/ 2>/dev/null || true
COPY --from=build /build/frontend/dist ./frontend/dist
ENV NODE_ENV=production
ENV PORT=3000
ENV NAV_DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["./backend/node_modules/.bin/tsx", "backend/src/main.ts"]
