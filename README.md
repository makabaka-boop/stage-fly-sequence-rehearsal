# 吊杆口令预演台

纯前端的舞台吊杆口令预演工具：把一叠口令卡拖放排序后，系统从**空载且归位**的初始状态逐卡推演，遇到第一张非法卡即停止，并给出首错位置、具体原因与当时的吊杆状态。无任何业务后端，不访问在线服务。

技术栈：React 18 + TypeScript + Vite；Vitest 验证裁决规则；Playwright 覆盖拖放重排后的复算。

## 口令卡含义

| 口令卡 | 前置条件 | 执行效果 |
| ------ | -------- | -------- |
| 装载 | 空载；重量为 1–500 千克的整数 | 吊杆载重 N 千克（归位、未锁定） |
| 锁定 | 已装载且未锁定 | 吊杆锁定 |
| 移动 | 已锁定且在归位 | 移动到舞台位 |
| 归位 | 在舞台位 | 返回归位 |
| 解锁 | 已锁定且已归位 | 解除锁定 |
| 卸载 | 已装载、未锁定，且本次装载已完成过「锁定→解锁」 | 卸空，回到空载归位的初始状态 |

标准闭环：**装载 → 锁定 → 移动 → 归位 → 解锁 → 卸载**，执行完回到空载归位。

> 装载后只能锁定：装载后直接卸载会被判为首错，必须先锁定再解锁才能卸载（装载与解锁后的物理状态相同，系统以「本次装载是否完成过锁定→解锁」区分二者）。

## 裁决规则

- 从初始状态（空载 · 归位 · 未锁定）按序列逐卡推演。
- **首错即停**：遇到第一张非法卡，该卡不改变状态，后续卡片一律标记「跳过」且不再生效。
- 界面保留首错前的完整轨迹、高亮首错卡并给出具体原因（如「未锁定先移动」「未归位先解锁」「装载重量必须为 1–500 千克的整数」）。
- 结论由卡片序列实时派生：**任何增删、改重量或拖放重排都会清除旧结论并重新裁决**，不存在过期结果。
- 三种结论：**闭合**（全部合法且回到空载归位）、**首错**（唯一定位第一张非法卡）、**未闭合**（全部合法但停在中途状态）。

## 启动方式（Docker Compose）

```bash
# 启动预演台，默认 http://localhost:8080
docker compose up --build web

# 用 WEB_PORT 覆盖宿主端口，例如 http://localhost:9000
WEB_PORT=9000 docker compose up --build web

# 一次性验收：构建后运行 Vitest + Playwright，结束即退出，退出码即验收结果
docker compose run --rm verify
```

`web` 服务为 nginx 托管的纯静态站点；`verify` 服务基于 Playwright 官方镜像，自带浏览器，独立构建并测试，不依赖 `web` 运行。

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm run test       # Vitest 裁决规则测试
npm run test:e2e   # Playwright 端到端测试（首次需 npx playwright install chromium）
npm run verify     # 构建 + 单元测试 + 端到端测试
```

## 项目结构

```
src/domain/       状态机与裁决（types / machine / cards / describe），纯函数、无 UI 依赖
src/components/   牌库、可拖放序列、裁决横幅、状态面板、推演轨迹
src/domain/__tests__/machine.test.ts   Vitest 裁决规则
e2e/reorder.spec.ts                    Playwright 拖放重排复算
Dockerfile        多阶段：deps → build → web（nginx）/ verify（Playwright 镜像）
docker-compose.yml                     web 服务（WEB_PORT 覆盖端口）+ verify 一次性验收
```
