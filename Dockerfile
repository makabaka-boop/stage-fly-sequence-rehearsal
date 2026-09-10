# syntax=docker/dockerfile:1

# ---- 依赖层：按锁文件安装，保证可复现 ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建层：产出纯静态资源 ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 运行层：nginx 托管静态文件，无任何业务后端 ----
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- 验收层：一次性运行单元测试与端到端测试后退出 ----
FROM mcr.microsoft.com/playwright:v1.47.2-jammy AS verify
ENV CI=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# 构建期产出 dist 并验证可构建；运行时直接复用，仅执行测试
RUN npm run build
CMD ["sh", "-c", "npx vitest run && npx playwright test"]
