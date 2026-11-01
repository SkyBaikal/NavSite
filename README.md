# NavSite 🧭

一个**完全自定义、零 CDN 依赖**的个人导航站。一切皆 Widget、一切皆配置、一切皆事件。

## 快速开始（本机开发）

```bash
# 后端（端口 3000）
cd backend && pnpm install && npx tsx src/main.ts

# 前端开发模式（端口 5173，可选）
cd frontend && pnpm install && npx vite

# 生产构建（构建后由后端 3000 端口直接托管）
cd frontend && npx vite build
```

访问：
- 前台 http://localhost:3000/
- 后台 http://localhost:3000/admin/admin.html （默认 admin/admin123，首次启动自动创建）
- 编辑器 http://localhost:3000/admin/editor.html （空间/布局/主题）

## Docker 部署（单容器）

```bash
# 构建镜像（首次较慢，需编译 better-sqlite3）
docker build -t navsite:latest .

# 方式一：docker compose（推荐）
#   先编辑 docker-compose.yml：改 ADMIN_PASS 和 NAV_SECRET（随机长字符串）！
docker compose up -d
# 访问 http://localhost:8080/

# 方式二：裸 docker run
docker run -d --name navsite -p 8080:3000 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_PASS=你的密码 \
  -e NAV_SECRET=随机长字符串 \
  --restart unless-stopped \
  navsite:latest
```

镜像说明：两阶段构建（vite 前端构建 → alpine 运行时），better-sqlite3 在容器内源码编译（musl 兼容，镜像内已验证），内置 `.dockerignore` 防止本地 node_modules 污染。

## 迁移 / 备份（三层）

| 层 | 方式 | 适用 |
|---|---|---|
| 整机迁移 | 停容器 → 拷 `data/` 目录 → 新机 `docker compose up -d` | 换机器/换服务器（已实测：库+图标+预览缓存+备份全随目录走，✅） |
| 自动备份 | 每天 04:00 全量导出 `data/backups/`，保留 14 份；后台「🗄️ 自动备份」可手动备份/下载 | 误删回滚（备份即 export 格式，可直接导入恢复） |
| 逃生舱 | 后台「导出 JSON」/「导入配置包」（merge 去重 / full 清空重建） | 跨版本、人工审阅、部分恢复 |

## Widget 市场（第三方生态）

- 后台「🧩 Widget 市场」：查看内置 9 种 widget、粘贴 manifest JSON 安装第三方（id/semver/desc 校验，内置 id 冲突拦截）
- 第三方 widget 运行时：**iframe 沙箱**（`sandbox="allow-scripts"`，独立 origin，拿不到 cookie/父页 DOM）+ 白名单 API（`navsite.setState/getProps/toast`，postMessage 通信）+ 代码 ≤64KB + CSP `default-src 'none'`
- 安装后在市场表格点「代码」写入运行时 JS（操作 `root` 元素），保存即生效

## 功能

- ✅ 多空间（独立布局+主题，方向感切换动画，数字键 1-9 快切，SSE 定时切空间）
- ✅ Widget（9 种内置）：搜索（多引擎）/ 时钟 / 分类 / 一言 / 速记便签 / 习惯打卡（连续天数+热力图）/ RSS 订阅 / 天气 / 每日一图（Bing 壁纸）
- ✅ Widget 市场：manifest 校验安装器 + iframe 沙箱运行时（第三方 widget 安全执行）
- ✅ 主题引擎：Design Tokens → CSS 变量，6 套预设 + 精细调色 + 随机主题
- ✅ 布局编辑器：12 列网格、模块拖拽重排、增删移调宽
- ✅ 联动规则引擎：WHEN 事件 → THEN 动作（写日志/切空间），可视化编辑 + 测试触发 + 事件日志
- ✅ 命令面板：Ctrl+K（搜链接、切空间、快速添加 `add 标题 网址`、彩蛋 `/matrix` `/snow` `/fireworks`）
- ✅ 彩蛋系统：数字雨 / 下雪 / 烟花，纯 canvas 零依赖
- ✅ 音效引擎：Web Audio 合成（点击/切换/风铃），零音频文件，页脚开关
- ✅ 链接管理：后台模态编辑（跨分类移动/可见性）、前台拖拽排序、浏览器书签导入
- ✅ 外部依赖健康监控：`/api/health/upstream` + widget「📴 离线数据」角标 + 全链路缓存兜底（失效不白屏）
- ✅ 移动端适配（390px 实测）、`prefers-reduced-motion` 无障碍降级
- ✅ favicon/预览图本地代理缓存（7 天，SSRF 防护）、og 元数据抓取（悬停预览）
- ✅ 点击统计、登录限速、签名 Cookie、JSON 导出逃生舱

## 架构原则

1. 一切皆 Widget —— 加功能 = 注册新组件，零引擎改动
2. 一切皆配置 —— 布局/主题/空间全是 JSON，可导入导出
3. 一切皆事件 —— 打卡/切换/时间触发都是事件，新玩法靠订阅组合
4. 零 CDN —— 所有资源本地化，完全代码可控
5. data/ 即世界 —— 容器无状态，迁移 = 拷目录

---

## ✨ 功能总览（v3.0）

- **导航**：分类/链接管理、自动抓取图标标题、搜索（站内+多引擎）、点击统计、删除撤销、浏览器书签导入（500 条 <1s）、CSV 导出
- **14 个内置 Widget**：搜索框/时钟/分类/一言/速记/习惯打卡/RSS/天气/每日一图/倒计时/最近访问/句子收藏/待办/番茄钟 + 第三方 Widget 市场（iframe 沙箱）
- **外观**：曜石玻璃拟态主题、亮色可切换、每日轮换本地艺术壁纸（零版权）、HUD 科技感层、自定义 CSS 注入、per-widget 背景图与样式、时段副语
- **管理后台**：玻璃侧边导航、外观遥控、🔑 密码自助修改、🛡️ 两步验证（TOTP）、只读账号、审计日志、自动备份/恢复、事件日志自动轮转
- **安全**：bcrypt+登录限速+签名 session、CSP 六安全头、SSRF 内网黑名单、SQL 全参数化、XSS esc 全量、红队 18 项实测

## 🔒 HTTPS 部署（Caddy 反代，推荐）

Caddy 自动申请/续期 Let's Encrypt 证书，配置最简单：

1. 准备一个域名（如 nav.example.com）A 记录指向服务器 IP
2. 安装 Caddy：`sudo apt install caddy`（或官网一键脚本）
3. 写 `/etc/caddy/Caddyfile`：

```
nav.example.com {
    reverse_proxy localhost:3000
}
```

4. `sudo systemctl reload caddy` —— 完成。证书自动管理。

### docker-compose 场景

```yaml
services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
  navsite:
    image: navsite:latest
    # 不映射 3000 到公网，仅 Caddy 内网可达
volumes:
  caddy_data:
```

Caddyfile 中 `reverse_proxy navsite:3000`（同 compose 网络用服务名）。

### 安全建议
- 生产环境务必设置 `NAV_SECRET` 环境变量（否则每次重启 session 全失效）
- 启用两步验证（后台 → 🔑 → 🛡️ 两步验证）
- 有条件可加 Cloudflare 前置（隐藏源站 IP + DDoS 防护）

