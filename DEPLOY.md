# 🚀 NavSite 部署交接文档（v3.2 终态）

> 生成于 2026-11-01。项目：个人导航站「一切皆 Widget、一切皆配置、一切皆事件」。

## 一、当前资产

| 资产 | 位置 / 说明 |
|---|---|
| 源码 | `/home/agentuser/navsite/`（git 仓库，tag：v3.0 / v3.1 / v3.2 + 打磨 commit） |
| Docker 镜像 | `navsite:latest`（5c22335dd806，1.11GB，零外网启动，实测通过） |
| 数据 | `data/nav.db`（SQLite 单文件）+ `data/icons|previews|backups/`，**拷 data/ 即迁移** |
| 凭证 | 管理员 `admin`（密码以 DB 为准）；只读账号 `guest`；容器环境变量 `ADMIN_PASS` / `NAV_SECRET`（[REDACTED] 见 docker-compose.yml） |
| 进度日志 | `PROGRESS.md`（v1.0 → v3.2 全存档） |

## 二、三种部署方式

### A. Docker Compose（推荐）
```bash
cd navsite && sudo -n docker compose up -d
# 访问 http://<host>:3000  后台 /admin/admin.html
```

### B. Docker 手动
```bash
sudo docker build -t navsite:latest .
sudo docker run -d -p 3000:3000 -v $PWD/data:/app/data \
  -e ADMIN_PASS=<密码> -e NAV_SECRET=<随机串> navsite:latest
```

### C. 裸机运行
```bash
cd backend && npx tsx src/main.ts   # 需 Node 22+
# 前端需先 cd frontend && npx vite build
```

### HTTPS（可选）
README「🔒 HTTPS 部署」节有 Caddy 两行反代配置；需真实域名 + A 记录。

## 三、数据迁移 / 备份

- **迁移** = 停容器 → 拷整个 `data/` 目录 → 起新容器。完毕。
- 每日自动备份在 `data/backups/`（保留 14 份）。
- ⚠️ `NAV_SECRET` 变了会使旧 session 失效（重新登录即可，数据无损）。

## 四、v3.2 新功能速查（九项）

1. 📊 数据洞察仪表盘（后台「洞察」板块）
2. 🔥 常用上浮（`settings.hotFloat`，后台外观区有开关）
3. 🔍 全局搜索（前台 Ctrl+K，搜链接+待办+速记+句子）
4. 🧭 智能空间切换（空间 `switch_rule`：`{mode:'schedule', start:'09:00', end:'18:00'}`）
5. ⏰ 提醒引擎（倒计时 <24h / RSS 更新 → toast，每 10 分钟检查）
6. 🖱️ 编辑器卡片拖拽换位
7. 📘 Widget SDK 文档 `docs/WIDGET_SDK.md`
9. 📱 手机推送（automation `notify` action：Bark / Server酱，配真 key 即用；站内 toast 改名 `toast` action）
10. 🎬 开机 HUD 启动动画（每会话一次）

## 五、运维排障备忘（血泪浓缩）

- 改前端代码后：注销 SW + 清 caches 才能看到新 bundle
- admin 大 patch 前先 `cp admin.html admin.html.bak`，patch 后 `node --check`
- `patch 后 async 双写/丢失` 是本项目高频事故，正则扫「await 无 async」
- SQLite 用 node better-sqlite3 直查（sqlite3 CLI 有 WAL 视图坑）
- 后端保活：`setsid nohup npx tsx src/main.ts > /tmp/navsite.log 2>&1 &`
- `.widget` 背景图功能：CSS 用 `background-color` 分属性，禁简写覆盖内联图

## 六、遗留可选项（不影响上线）

- widget 像素级自由摆放（点子 6 优雅版）
- 2FA 已实现未开启（后台「🔑 管理密码」随时可开）
- 配置包商店（点子 8 未选）、语音指令（点子 11 未选）
