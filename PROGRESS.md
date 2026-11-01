# NavSite 开发进度

## 版本状态

### v1.1（当前）✅ 主体完成
- [x] 前台渲染引擎（Vue3 完整版 + hash布局）
- [x] 后台管理（admin.html：分类/链接 CRUD + 登录）
- [x] 布局/主题编辑器（editor.html：空间管理 + 网格布局 + 主题令牌）
- [x] 命令面板 Ctrl+K（搜链接/切空间/开编辑器，键盘导航完整）
- [x] Widget: searchbar / clock / category / hitokoto / quicknote
- [x] favicon 本地代理（缓存7天 + SSRF 黑名单）
- [x] 微交互：卡片高光跟随 + stagger 入场
- [x] 多空间：布局+主题独立
- [x] Dockerfile + docker-compose.yml + README
- [x] 零 CDN 验收通过

### 已完成（截至当前）
- [x] 联动规则引擎（automation.ts：fireEvent/executeAction + WHEN/THEN 编辑器 UI + 测试触发 + 事件日志）✅ API+UI 全验收
- [x] 彩蛋系统（/matrix 数字雨、/snow 下雪、/fireworks 烟花、/clear，eastereggs.js，命令面板触发，截图验收 matrix+snow）
- [x] 习惯打卡 widget（habit：多项打卡、🔥连续天数、跨天重置逻辑、公开 /api/widgets/:id/state 读写、widget 自动分配 id wN）
- [x] widget 稳定 id：保存空间布局时 assignWidgetIds 自动补 id（w1..wN），PUT 保留已有 id 不重排
- [x] RSS 订阅 widget（/api/rss 零依赖 XML 解析 + 30 分钟缓存 + 失败回退过期缓存 + SSRF 拦截；前端 8 条摘要带日期，HN 实测 20 items）
- [x] 音效引擎（Web Audio 合成：click/pop/switch/chime，零音频文件；localStorage 持久开关；页脚 🔊/🔇 切换 + 链接点击/切空间触发）
- [x] 每日一图 widget（/api/dailyshot 代理 Bing 壁纸 API，6 小时缓存；前端渐变字幕+hover 缩放，「林间迷雾」1920px 实测）
- [x] 外部依赖健康监控（upstream.ts trackedFetch 统一包装 rss/weather/bing 外呼 + /api/health/upstream 公开报告 + widget 📴离线数据 角标（上游 2 小时无成功时显示））
- [x] 空间切换方向动画（:key 重建 + slideL/slideR 按空间顺序判方向 + prefers-reduced-motion 无障碍降级；实测 space-in-left/right）
- [x] 分类排序（POST /api/admin/categories/reorder 事务 API + 后台分类行 ↑/↓ 按钮；↓ 上移实测换位、边界 no-op 正确、curl 全序反转/恢复实测）
- [x] 第三方 widget 运行时沙箱（market.ts 扩展：GET /api/widget-runtime/:id 生成 iframe srcdoc 沙箱页（sandbox=allow-scripts 独立 origin + CSP default-src 'none' + 白名单 API navsite.setState/getProps/toast postMessage 通信）+ POST /:id/code 保存运行时代码（admin，≤64KB）+ POST /event 事件持久化；实测：pomodoro 🍅 沙箱内渲染 + toast 消息到达父页 ✅、父页访问沙箱 DOM 被 SecurityError 拦截 ✅（隔离生效）、未安装 404/超限 400 ✅；修复占位符 replace 只换第一处 bug；后台市场表格加「代码」按钮；演示数据已清理）
- [x] 前端新增 3 个 widget（2026-11-01，共 12 种内置）：⏳ 倒计时（settings 共享、nearest/all 两模式、7 天内红色脉冲、"就是今天🎉"、上限 20、日期校验）、🕒 最近访问（events_log link.click 流 JOIN links、去重取最新 12、favicon 兜底）、✒️ 句子收藏（user_state 本地存储、‹›翻页、双击删除、上限 50）；后端新增 GET /api/links/recent + GET/POST /api/countdowns；editor WIDGET_TYPES 补 3 项；实测：倒计时"测试生日 还有 54 天"、quote 添加"凡是过往，皆为序章——莎士比亚"、recent 显示 GitHub+favicon 代理 ✅。坑：onUnmounted 未 import 致 countdown 整卡消失（Vue 吞 setup 错误）；模板表达式 new URL() 移入 setup hostOf（try/catch）；SW stale-while-revalidate 缓存旧 index.html——改代码后必须注销 SW+清 caches 再刷）
- [x] 后台补强 7 连（2026-11-01）：①链接批量操作+全局搜索（勾选多选/批量移动到分类/批量显示隐藏/批量删除/全选/标题URL描述关键字搜索/分类过滤/计数徽标）②联动规则动作扩展 2→6（switch_theme/toggle_widget/notify/webhook，SSE 新增 theme/widgets_changed 事件，实测一次 space.switch 触发双规则 notify+theme=sunset，events_log 实锤）③操作审计（auditTrail 中间件：写操作自动落 events_log audit.* 条目）④编辑器实时预览（👁 iframe 弹窗，截图验收）⑤后台移动端适配（640px 断点，390px 截图验收）⑥只读账号 viewer（002_viewers 迁移+登录 role 区分+requireAdmin 写拦截 403，实测 guest 可读/写 403；修双引号 SQL+verify 返回对象两 bug）
- [x] 整体打磨第二轮·空状态/动画/移动端（2026-11-01）：①空状态插画（cd/rc/qt 空 data 居中大 emoji ⏳👣✒️ + 文案呼吸动画，清 8 进制转义踩坑用字面 emoji）②搜索结果面板入场动画（scale+fade 下拉 + 结果项逐条 stagger 左滑，阴影走 --shadow-pop）③命令面板入场动画（overlay 淡入 + box 弹性上浮 cubic-bezier 弹一下）④移动端细调（widget 内边距/rss 字号/每日一图高度 150px/页脚 kbd 缩小/主题浮钮 38px 上移避让）⑤截图验收：空状态居中插画✅ 搜索面板带图标描述✅ 移动端三段无溢出无挤压✅
- [x] 整体打磨·视觉/细节/操作（2026-11-01）：①widget 统一卡片化（背景/边框/圆角/微阴影+hover 升层，时钟/一言保持通栏裸排）②链接卡片 hover 阴影走 --shadow-card+accent 混色边框 ③页脚 kbd 双层下边框拟按键+字距 ④热力图格子 hover 放大 1.4x ⑤cd/rc/qt 标题字距统一 ⑥主题浮钮毛玻璃+上移避让页脚 ⑦:focus-visible 焦点环+prefers-reduced-motion 降级 ⑧清 demo 测试数据（句子/倒计时）；四段截图+computed style 验收（阴影/圆角/kbd/焦点环/浮钮位置全生效）
- [x] 📊 数据统计板块（2026-11-01）：GET /api/admin/stats（6 项总览含数据库体积、近14天 link.click 日趋势、Top10 点击、近500条事件分布）+ admin.html 📊 板块（总览卡/纯 div 柱状图 hover 看日期次数/Top10 条形图/事件胶囊中文化 ETYPES）；实测 6 卡/14 柱/Top1/12 胶囊渲染正确（截图验收）；修 backupNow 内被误插 loadStats 的 replace 错位（真实挂载点在 loadAll）
- [x] 暗夜模式适配层（2026-11-01）：CSS 变量化阴影（--shadow-card/--shadow-pop）+ html[data-theme="暗夜"] 覆盖块（color-scheme:dark、每日一图 brightness(.82)+saturate(.9)、图片柔化、暗色滚动条、倒计时红 #f87171、toast/habit/input 可读性）；双主题截图验收无刺眼白块/无不可读文字；亮⇄暗往返无回归
- [x] 🌓 亮暗主题一键切换（2026-11-01）：前台右下角浮动圆钮（按 --color-bg 亮度显示 🌙/☀️）；POST /api/theme/toggle 判断背景亮度→写空间 theme_json（暗夜⇄纸墨）+ SSE 广播（onTheme 兼容 string/object），其它标签页实时跟随；实测双向切换/图标翻转/theme_json 持久化/暗夜截图 ✅；坑：onMounted 不能在组件 setup 外调用（改模块级 DOMContentLoaded 挂载）
- [x] 模块管理双补强（2026-11-01）：①⚙️ widget props 编辑（editor.html WIDGET_TYPES 加 fields schema：RSS feed/limit、weather city、countdown mode、recent limit；openProps 弹窗含 select/number/text，保存进 layout props 后前台生效；RSS 组件改读 props.feed+limit——修 maxItems 未 return 致模板取 undefined 的坑）②🧬 后台模块数据管理（GET /api/admin/widget-data 全量 user_state 一览+倒计时计数、DELETE /:widgetId/:key 按项清空、DELETE /countdowns；admin.html 新板块展示+清空按钮，操作落 audit.widget_data.clear 审计；实测清空→重写恢复全链路；修 user_state 无 JOIN widgets 表/无 updated_at 列、admin.html t 变量名遮蔽两 bug）
- [x] 数据迁移实测（本机真实 data/ 目录拷贝 → 挂载容器 8081：无重新迁移/无重建 admin（复用现有库）✅、分类链接/空间/备份文件/图标缓存全部随目录到位 ✅、登录 OK、浏览器截图 RSS+天气 26°C+每日一图+热力图全量复现 ✅——「拷目录即迁移」承诺兑现）
- [x] Docker 镜像构建实测（本机装 docker.io 29.1.3 + daocloud registry mirror；排障 5 连：pnpm 12 构建脚本拦截（esbuild/better-sqlite3 → pnpm-workspace.yaml onlyBuiltDependencies+dangerouslyAllowAllBuilds）、alpine 缺编译链（apk add python3 make g++ + 阿里镜像源加速）、musl 误用 glibc prebuild（rm -rf build prebuilds 强制 node-gyp 源码编译）、本地 backend/node_modules 被 COPY 覆盖容器编译产物（新增 .dockerignore）、目录结构错位（src/db/dist 路径修正）；最终 navsite:latest（264MB 压缩）容器端到端：迁移/登录/备份/市场/前台/admin/editor/sw.js/图标全 200 ✅ 截图验收）
- [x] 自动备份引擎（backend/src/services/backup.ts：每天 04:00 全量导出 data/backups/backup-<stamp>.json + 保留 14 份自动清理 + events_log 记录；管理 API 列表/立即备份/下载（文件名白名单+路径穿越拦截实测 INVALID）+ 后台 🗄️ UI（列表/立即备份/下载，实测 2 份备份展示）；备份内容=export 同格式可直接 import 恢复）
- [x] PWA 离线支持（manifest.webmanifest + icon.svg/icon-192/512.png（PIL 绘制渐变 N 图标）+ sw.js：外壳 stale-while-revalidate、API network-first 失败回缓存、POST 永不拦截、旧缓存版本清理；CDP 模拟断网实测 /api/spaces 与 /icon.svg 均从 SW 缓存命中 200 ✅）
- [x] Widget 市场雏形（backend/src/services/market.ts：内置 9 widget 目录 GET /api/market + manifest 校验安装器（id/semver/desc/props 校验、内置 id 冲突拦截）POST install / uninstall（联动从布局摘除）/ installed 列表 + 后台「🧩 Widget 市场」UI（粘贴 manifest 安装/刷新/卸载）；API 四路实测 + UI 安装→卸载全流程 ✅）
- [x] 配置包导入（POST /api/admin/import：merge 模式 URL 去重追加/空间跳重名 + full 模式清空重建（双确认 confirm+confirm_text）+ 后台上传 UI；导出→merge 全去重跳过 5/5+2/2 ✅、导出→full round-trip 数据一致 ✅）
- [x] 全量回归绿灯（前台 10 widgets/5 卡片/84 热力格/8 RSS/天气/壁纸1920px/音效开关/命令面板/admin+editor 200/健康 3 上游全 ok/0 JS 错误）+ README 功能清单终稿
- [x] 打卡历史热力图（habit 打卡自动写 habit_history 按天快照（保留120天）+ GET /widgets/:id/history + 前端 12周×7天 GitHub 风格格子（0-3 级深浅按完成项数），日期 key ISO 对齐 bug 修复，格子渲染实测）
- [x] 链接编辑模态框（后台编辑链接：标题/URL/描述/跨分类移动/前台可见开关，替代原 prompt 三连弹；MDN 移入设计灵感再移回，前台 API 同步实测）
- [x] 链接拖拽排序（POST /api/admin/links/reorder 批量重排事务 API ✅ curl 实测反转/恢复；前台卡片 :draggable 登录态开启（/api/admin/me 探测）+ drop 重排逻辑 + toast 轻提示组件；⚠️合成 DragEvent 无法完整模拟原生拖拽，真实鼠标拖拽待人工验收）
- [x] 数字键 1-9 快捷切空间（输入框聚焦时屏蔽；页脚快捷键提示更新）
- [x] 编辑器拖拽排序（HTML5 DnD 拖动 widget 块重排 + 虚线高亮 + 新 widget 类型标签补全，模拟拖拽实测重排/复原/保存）
- [x] 天气 widget（/api/weather 代理 wttr.in j1 格式，30 分钟缓存、天气码→emoji 映射、失败回退缓存；前端 Hangzhou 17°C 实测）
- [x] 站点预览卡片（/api/preview og:image 抓取 24h 缓存 + /api/image 图片代理 7 天磁盘缓存 + HTML 实体解码 + SSRF 拦截；前端悬停浮层 peekIn 动画、懒加载、z-index 修复，GitHub monkey 图验收）
- [x] 定时切空间（scheduler.ts 30s 轮询 switch_rule + SSE 推送 /api/events/space + 前端 EventSource 接收）✅
- [x] 书签 HTML 导入（解析 H3/A 标签、INSERT OR IGNORE 去重、计数修复）✅
- [x] 快速添加命令（Ctrl+K 输入 add 标题 网址）✅
- [x] 移动端适配（640px/900px 断点）✅
- [x] 一言/速记 widget、命令面板、高光跟随、stagger 入场 ✅

### 待做
- [ ] 彩蛋系统（/matrix /snow 等命令触发）
- [ ] habit 打卡 widget + 热力图
- [ ] 站点截图预览卡片（需无头浏览器截图服务）
- [ ] 自研 widget 目录热加载
- [ ] 主题/配置导入导出 UI
- [ ] 便签 widget 在编辑器中添加时自动建 widgets 表实例（目前 quicknote 依赖 widget.id）

## 已踩坑（重要）
1. Vue 模板编译需 alias `vue: 'vue/dist/vue.esm-bundler.js'`（vite.config）
2. pnpm 10 默认拦截 better-sqlite3 构建脚本 → 需手动 rebuild
3. spaces 的 layout_json 曾双重编码 → 后端 norm() 统一处理
4. 前端 build 后由 backend 托管（3000端口），dev 模式才用 vite 5173
5. 后台静态页在 /admin/admin.html（不是 /admin/）
6. 重启后端后浏览器 cookie 仍在但需重新验证（SECRET 未持久化时重启会失效 → 建议 .env 固定 NAV_SECRET）

## 关键文件
- backend/src/main.ts — 入口
- backend/src/routes/public.ts — 前台 API
- backend/src/routes/admin.ts — 后台 API（含 widget state）
- backend/src/services/favicon.ts — 图标代理
- backend/public/{admin,editor}.html — 后台/编辑器（无框架原生 JS）
- frontend/src/main.js — 前台渲染引擎（含全部 widget + 命令面板）
- db/migrations/001_init.sql — 表结构（7张表）

- [x] 🔒 安全补齐至工业级（2026-11-01）：审计=bcrypt/限速/SameSite=Lax/参数化SQL/favicon SSRF黑名单/路径白名单/沙箱 五项底子确认；补齐 4 项：①安全响应头中间件（CSP self+inline+eval[Vue runtime 模板编译必需]/nosniff/DENY/Referrer-Policy/Permissions-Policy/frame-ancestors none，实测前台+admin 回归）②共享 ssrf.ts（isSafeExternalUrl 内网黑名单+IPv6 ULA+docker internal）webhook 接入——实测 https://192.168.1.1 被"阻止内网地址"拦截 ③admin.html/editor.html 全量 esc() 转义（分类/链接/空间名/市场 manifest 字段）④顺带发现并修复：POST /links/:id/click 只落 events_log 不触发联动规则（旧 bug）→ 改调 fireEvent。排障：Vue esm-bundler 模板编译需 unsafe-eval；SW 缓存旧页面假象。
- [x] 🧹 events_log 自动轮转（2026-11-01）：retention.ts 双保险（条数硬上限 2 万 + 时间 90 天/审计 365 天分级保留），每日 5 点定时 + POST /api/admin/events/prune 手动触发；实测插入 -100 天普通事件 5 条与 -400 天审计事件 3 条→prune deleted:8 精准清掉（新数据零误伤）
- [x] 👁 widget 可见性开关 + ⏸️ 第三方 widget 启停（2026-11-01，评估清单③④收官）：③ editor 网格卡片加 👁/🚫 切换（写 layout item.hidden，半透明预览），前台 v-if="!w.hidden" 跳过渲染——实测 w14 隐藏前台消失、还原恢复；④ installed_widgets 加 disabled 字段 + POST /api/market/toggle（审计落账）+ runtime 端点 disabled→403 + 市场目录合并第三方列表（GET /api/market 修复：原来只列内置）——实测 停用→403→启用→200→卸载 全链路。坑：模板 replace 误插双重 <template v-for> 致 Vue 编译崩（compiler-24 白屏）
- [x] 🔍 红队自测深挖（2026-11-01）：18 项攻击面测试——未认证 API 全 401、viewer 越权全 403（新账号 auditor 全矩阵复验后删除）、备份路径穿越 URL 编码 400、body 413、runtime id 注入/超长 400、搜索 SQL 注入返回空（参数化有效）、SSE/倒计时校验 OK。**抓到并修复 1 个真漏洞**：POST /widgets/:id/state 公开写无校验——垃圾 widget_id（含 SQL 注入样字符串原样落库）、无 value 写 null、单条无大小限制（垃圾堆积面）。修复：id 格式白名单 + value 必填 + key≤64 + 单条 64KB 上限；清理了攻击残留数据。
- [x] 🎨 前台展示+后台管理完善（2026-11-01）：前台三处（RSS 日期友好化 今天/昨天/N天前/M月D日、天气描述 ellipsis 防溢出、亮色细滚动条）；后台两处（👥 只读账号管理板块=列出/添加/删除，🧹 清理过期日志按钮接 /events/prune）。坑：同文件连续两次 patch 用了旧变量导致 A/B 丢失——多 patch 必须重读文件
- [x] 🚀 ABC 大批量（2026-11-01）：A 前台=布局密度切换（⇔/≡ 浮钮，localStorage 持久，紧凑模式收 gap/padding）、分类卡内过滤（≥8 链接显示 🔍 输入框，标题/URL/描述匹配）、RSS 日期友好化+天气 ellipsis（上轮）；B 后台=CSV 导出（链接+事件，\ufeff BOM 保中文 Excel 兼容，401 保护实测）、删除撤销（删除链接/分类后底部 6s 撤销条，分类撤销含子链接重建，实测删除→重建链路）；C 新 widget×2=📝 待办清单（user_state 存储、过滤三态、勾选/清除已完成、transition 动画）+ 🍅 番茄钟（SVG 圆环进度、25/5 切换、完成 toast+音效、onUnmounted 清理）。14 内置 widget。坑：registry.todo 首插因 "\n};\n" 定位错丢失；CSS 插 </style> 而样式实为 JS 模板字符串致 build 炸——样式插入点=toast 行后
- [x] 🚀 完善第二轮（2026-11-01）：pomodoro props 可配（focusMin/restMin）+ 今日番茄数持久化（跨刷新，跨天归零）；分类卡展开/收起（>12 显示"展开其余 N 个"）；命令面板基础命令按关键词过滤（修复：面板原本不过滤）；后台「🕐 最近事件」流水（20 条，audit 显示请求路径）；**顺手修复上轮丢失的 category q/filtered 定义（模板悬空引用会崩分类卡）**
- [x] 🎛️ 后台完全控制三件套（2026-11-01）：①自定义 CSS（后台 🎛️ 外观遥控板块 textarea → settings.appearance.custom_css → 公开 /api/appearance → 前台注入 <style id=appearanceCss>）②可配置文案（站名 logo/标题、搜索占位符、页脚 HTML、自定义搜索引擎 JSON 数组合并进引擎下拉）③per-widget 自定义样式（editor 无 fields 的 widget ⚙️ 打开公共弹窗写 CSS 声明 → props.css → 前台 :style 数组合并）。**修复途中连带发现：布局 categoryId 1/2/3 与真实分类 id 7/8/9 脱节致 3 张分类卡消失（历史 viewer 测试轮重建分类所致）→ 已重绑**。坑×3：appearance ref 插进 CmdPalette 作用域 / 声明在 onMounted 内而 return 在 setup 顶层 → 白屏两次；Vue 模板不能直接引用 window（占位符/引擎）→ ref+computed+appearance-ready 事件
- [x] ✨ 视觉打磨·沉浸感层（2026-11-01，纯 CSS 零资源）：①纸感背景=SVG feTurbulence 噪点(data URI) + 顶部主题色 radial 光晕（暗夜加强）②顶栏实线分割→两端渐变淡出线 ③问候语渐变文字填充（accent→蓝紫）+ 暗夜时钟 text-shadow 微光 ④卡片顶部 1px 高光线（亮 .7 白/暗 .12）⑤空状态卡片点阵纹理填充 ⑥overlay 细滚动条 6px 半透明。vision 四图验收（亮首屏/暗夜/下半页/空状态）全部和谐无刺眼
- [x] 🎨 视觉二轮·选项 234（2026-11-01）：**2 开场动画**=app 淡入+logo 下浮+呼吸（5s 循环）+空间标签 4 连 fadeDown stagger+widget 1-8 依次浮入（80ms 阶梯）+时钟翻入 cubic-bezier 过冲，全受 prefers-reduced-motion 管辖；**3 排印升级**=系统 Noto Serif CJK SC ttc（26MB）经 pyftsubset(brotli woff2) 子集化至 2.1MB×2 字重落 public/fonts/（零 CDN 铁律），@font-face NavSerif（100-500 reg/600-900 bold，font-display swap），标题 700+letter-spacing .04em、时钟 800、正文 400→强对比排印；**4 时段主题**=body[data-daypart] dawn/day/dusk/night 按小时切换（每 10min 轮检），dawn 暖米/dusk 米褐/night 暗夜墨蓝 #16181d+卡片 #1d2026 更沉+分割线泛蓝光。E2E：fonts.check True、daypart=dusk 实渲染、深夜暗夜截图 vision 验收（墨蓝夜色+微光时钟）✅。坑：pyftsubset 需 --font-number=2 取 SC 子字体
- [x] 🔑 管理密码自助修改（2026-11-01）：POST /api/admin/password（requireAdmin：旧密码 bcrypt 校验 403 + 新密码 ≥8 位 400 + 成功 bcrypt 重哈希落 admin 表 + audit.password.change 审计，顺手修 payload 列名 label→payload_json）；admin.html 新增「🔑 管理密码」板块（旧密/新密/确认三输入 + 两次一致性前端校验）。E2E：未登录 401、旧密码错 403、短密码 400、改密成功→旧密码登录 BAD_CREDENTIALS→新密码 OK、审计落账、已还原 admin 原密码 ✅
- [x] 🏠 后台精装（2026-11-01，用户"界面太简陋像毛胚房"）：admin.html <style> 整体重写、对齐前台设计语言——①Noto Serif SC 全局衬线（与前台同族）②纸感背景（噪点 SVG data URI+顶部 teal 光晕，fixed）③卡片升级=--card 米白/12px 圆角/双层阴影/顶部 1px 高光线/入场 secIn 9 连 stagger（prefers-reduced-motion 全关）④header 2px 实线→渐变淡出线+标题 letterspacing ⑤按钮 hover 上浮+阴影、输入 focus 3px teal 光圈、表格行 hover 米绿底 ⑥登录卡居中精修+mainIn 淡入 ⑦overlay 滚动条 8px。h1 重复 🧭 改 CSS ::before。截图 adm-v2-* 三张 vision 验收（顶部/中段/🔑 板块）质感统一 ✅
- [x] 🌈 视觉三轮·去简陋（2026-11-01，用户"你不觉得很简陋吗"）：诊断=全页只有米白墨+teal 单色系/卡片千篇一律白盒/hero 留白过度变空洞。改造：①分类卡 6 色渐变顶条+标题色点（nth-of-type 6n 循环 teal/蓝/紫/琥珀/玫瑰/青）②链接项 hover 抬升+图标 accent 底衬 ③hero 时钟装饰线（greet 两侧渐变线）+时段副语 JS 注入（dawn"晨光正好宜启程"/dusk"暮色四合适合收尾今天的事"/night"夜深了…"）④widget 头部 flex 徽章化 ⑤句子收藏大引号 \u201c 装饰（JS 串八进制坑再现→字面字符）⑥footer opacity .75。v3 三截图 vision 验收：色条+色点+副语全部生效 ✅
- [x] 🌌 视觉四轮·曜石玻璃拟态（2026-11-01，用户"要炫酷现代不单调"）：默认主题整体转向暗色玻璃拟态——①:root 变量换曜石配色（bg #0b0e14/card rgba 白 5.5%/accent #2dd4bf/ink #e8eaf0）+纸墨亮色保留为切换项 ②极光背景：body::before/::after 两层 radial 光斑（teal+紫）blur 90px 26/32s 交替漂移 ③logo/时钟渐变霓虹文字（teal→蓝紫，drop-shadow 光晕）④卡片全量玻璃化 backdrop-filter blur(18px)+白 5.5%+发光阴影+hover teal 边框辉光 ⑤搜索框玻璃胶囊 focus 光圈 ⑥按钮渐变 teal ⑦主题数据驱动：spaces.theme_json 换曜石 tokens（applyTheme 写 CSS 变量）⑧坑：旧 body[data-daypart] 米色覆盖+纸感 body 背景后位覆盖变量→body background !important 绑变量+daypart 米色覆盖注释。v5 三截图 vision 验收：霓虹时钟/玻璃卡/光斑全部生效、可读性良好 ✅
- [x] ⚡ 视觉五轮·翻牌/视差+后台曜石统一（2026-11-01）：**前台**=秒针每秒动画（多方案迭代：:key 重建→Vue 全局引用错致 clock 白屏→改裸 ref；inline-block 动画在 background-clip:text 内渲染脱离成游离残影→秒针独立 teal 色+呼吸 opacity，时分保留渐变 clip）+分钟 minPulse 光脉冲+每日一图滚动视差（translateY y*0.06 上限 60px）。**后台 admin.html <style> 整体重写为同款曜石玻璃**：深蓝黑+双极光光斑 blob、渐变 logo（h1 ::before 🧭 保留原色）、玻璃 section（blur 18px+glow+hover teal 边）、渐变按钮+danger 渐变红、输入 focus teal 光圈、表格 hover、ok/err 消息玻璃化、入场 secIn stagger。三截图验收：前台霓虹时钟干净、后台与前台完全统一 ✅。坑：①Vue 全局 vs 解构 ref 混用→组件白屏 ②background-clip:text 元素内动画子元素渲染脱离（Chrome）→动画部分用纯色
- [x] 🔧 视觉六轮·Widget 细节精修（2026-11-01，用户"再优化 widget 细节"）：①RSS 条目 hover 左移 6px+teal 底+日期 teal 75%+细分隔线+末行去线 ②天气 emoji drop-shadow 微光+描述放宽 110px+meta 字距 ③待办筛选药丸玻璃化（选中 teal 14% 底+描边）+输入框玻璃圆角+清除按钮 hover 变红 ④番茄钟进度环 teal+drop-shadow 光+tabular-nums ⑤空状态文字 teal 微光 ⑥最近访问胶囊描边+hover teal ⑦footer 链接去蓝（muted+虚线下划线）⑧全 widget 加号按钮统一圆形玻璃 28px。w1-w3 三截图 vision 验收生效 ✅
- [x] 📐 视觉七轮·防贴边（2026-11-01，用户"图标触碰边框"）：诊断=天气☀️/待办📝/番茄🍅标题 emoji 与 RSS 条目文字贴卡片边（内 padding 仅 ~10px）。修：widget/category/card 统一左右 padding 16px、RSS 条目 6px（hover 12px）、天气 emoji+gap 10px、空状态 padding-top 26px、widget 首子元素 margin-top 2px。w7 三截图验收：全部图标离边舒适 ✅
- [x] 🖼️ 视觉八轮·本地艺术壁纸（2026-11-01，用户"自己生成图片/下载免费可商用图"）：Pillow 程序生成 6 张 1280x720 流体渐变壁纸（obsidian teal紫/violet 紫夜/abyss 深海/ember 琥珀/polar 极地蓝/rose 玫瑰夜，大 blob + GaussianBlur 200 + 对角光束 + 噪点 + gamma 0.72 提亮）+ 6 张 800x400 分类封面，共 ~450KB 落 public/art/（零版权零 CDN）。接入：JS 按日期（floor(ms/86400000)%6）每日轮换设 --wall 变量，body 背景壁纸+rgba(11,14,20,.55/.68) 暗化叠层（!important 防 body 简写覆盖）。坑：body background 简写 !important 清掉 background-image → 分属性 !important。w8 截图验收：壁纸透出、玻璃卡浮起、可读性佳 ✅
- [x] 🖼️ Widget 背景图功能（2026-11-01，用户"widget 支持设置背景图更有趣"）：**水印确认**：生成图为纯程序绘制像素，无任何文字/logo 水印。**editor**：openCommonProps 新增「背景图片」输入（URL 手填或内置六图下拉快选）→ 存 layout item props.bg；**前台**：widget :style 拼接 background-image=linear-gradient(rgba(13,17,26,.45/.60) 暗化)+url(props.bg)+cover；坑：玻璃规则 background 简写 !important 覆盖内联 background-image→改 background-color 分属性。E2E：habit=abyss/pomodoro=ember 实渲染，琥珀暖调透出与普通卡对比鲜明、可读 ✅
- [x] 🛰️ 视觉九轮·HUD 科技感（2026-11-01，用户"更炫酷更有科技感"）：①全屏极淡 teal 网格（radial mask 渐隐，与壁纸共存）②HUD 四角括号（hover 亮起+drop-shadow 辉光）③全息光扫（hover 斜光 0.8s 掠过）④标题 letter-spacing .12em+teal 微光+色点辉光 ⑤时钟上下刻度虚线（repeating-linear-gradient）⑥按钮/加号斜切角 clip-path（科幻面板风）⑦搜索框底部 teal 扫描线。hud 截图验收：霓虹时钟+网格+发光顶条效果出众 ✅
- [x] 🚀 v3.1 收官四连（2026-11-01，用户"1-2-3-4"）：**①git**=init+.gitignore(排除 data/db/dist/node_modules)+v3.0 全量提交+tag；**②真实使用**=交棒用户（数据现状 3 分类 5 链接）；**③硬功能**=移动端 390px 终检（零溢出，三段截图全正常，修页脚 padding 64px）+**2FA TOTP**（零依赖手写 RFC 6238 totp.ts：b32decode+HMAC-SHA1+±1 窗漂移；登录集成 TOTP_REQUIRED/TOTP_INVALID；端点 setup/enable/disable（关也需验证码）；admin 🔑 板块 UI；E2E 全流程 enable→无码 401→错码 401→对码 OK→disable→恢复，测试后已关闭）+HTTPS Caddy 指引入 README+书签导入实测（61 条去重导入 60；500 条 0.01s，压测数据已清）；**④锦上添花**=命令面板模糊搜索升级（子序列匹配+紧凑度评分排序）+Docker 镜像重建（sudo docker，0a7e205a7f7c）+README 功能总览终稿；git v3.1 tag。坑：①同文件 kernel 重复执行 patch 注入两次→外科修复时 j<i 误删 18K 字符→从文件内残余完整副本恢复+node --check 语法校验 ②doLogin/doLogout/changePass async 丢失（历史遗留） ③admin.html 与 editor.html 功能边界：布局编辑函数在 editor


## 🚀 v3.2 智能化超大批量（2026-11-01）

用户点选 1/2/3/4/5/6/7/9/10 九项，全部落地：

1. **📊 数据洞察仪表盘** — `GET /api/admin/insights`（累计点击/用过链接/最活跃时段/近 7 天趋势柱状/访问 TOP10/最近点击），后台新增「📈 数据洞察」板块（侧导航"洞察"项）。坑：api() 返回已是 data 层，勿再取 d.data。
2. **🔥 常用上浮** — 分类链接按 clicks 降序（settings.hotFloat 开关，默认 on；关闭恢复 sort_order）。坑：settings 无该 key 时子查询 NULL 恒 false→必须 INSERT 种子行；SQL 曾双写 "ORDER BY ORDER BY"。
3. **🔍 全局内容搜索** — `GET /api/search?q=`（链接标题/URL/描述 + user_state 待办/速记/句子 JSON 递归 LIKE），命令面板输入≥2 字符即追加命中结果（🔗链接可跳转 / 📝内容展示）。
4. **🧭 智能空间切换** — 空间 switch_rule 支持 `{mode:'schedule', start:'09:00', end:'18:00'}`，前台每分钟检查自动切换（手动模式不动）。
5. **⏰ 提醒引擎** — 前台每 10 分钟检查：倒计时 <24h toast（localStorage 去重）；RSS 顶条目标题变化 toast（localStorage 存上次头条）。
6. **🖱️ 自由摆放** — editor 网格卡片 HTML5 拖拽换位（dragstart/dragover/drop + splice 持久化 layout）。
7. **📘 Widget SDK 文档** — `docs/WIDGET_SDK.md`（manifest 结构/沙箱 postMessage 能力表/最小示例/安装调试/上架规范）。
9. **📱 Bot/手机推送** — automation 新增 `notify` action：Bark(iOS `api.day.app`) / Server酱(`sctapi.ftqq.com`) GET 推送，SSRF 校验+events_log 记录（action.notify）；原站内 toast 改名 `toast` action。E2E：假 key 打通 Bark 真实返回 400（端到端 HTTP 走通）。
10. **🎬 开机 HUD 启动序列** — 每会话一次 0.9s：NAV·SITE 发光 logo+扫描线+SYSTEM READY→淡出（sessionStorage 去重）。

**排障记录**：insights 板块 `d.data` 多层解构+async 缺失双错→`const {...} = d` + async 修复；自动化 notify 与站内 toast 同名 case 冲突（旧 case 先拦截）→改名区分。


## 🎨 自由摆放优雅版（v3.2 后续施工，2026-11-01）

- widget layout 条目新增可选 `h`（1-6 行）：editor「宽度」按钮升级为宽度+高度 prompt；renderGrid/editor-grid 应用 `grid-row: span h` + `grid-auto-rows:minmax(52px,auto)` + `grid-auto-flow:row dense`（自动填坑）。
- 前台同步：`.grid` dense + minmax(90px,auto)；widget :style 支持 h；span 行时加 `align-self:stretch`（关键！grid 默认 align-items:start 会把 span 行卡压缩成内容高）。
- 坑：SW 缓存导致新 bundle 不生效→unregister+caches.delete+cache-bust 三连。
- weather h=2 实测 407px 生效后还原（内容少的卡不适合高行，留用户自配）。
