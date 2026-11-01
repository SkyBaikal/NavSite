# NavSite Widget SDK 开发指南

> 5 分钟写一个属于你的 Widget。零框架、零构建，一个 JSON + 一段 JS 即可上架市场。

## 一、Widget 是什么

NavSite 中一切可见内容都是 Widget。第三方 Widget 以 **manifest JSON + JS 代码** 形式安装，运行在 **独立 origin 的 iframe 沙箱** 中，与主站通过 `postMessage` 通信。

## 二、Manifest 结构

```json
{
  "id": "my-widget",           // 全局唯一 ID（小写字母数字连字符）
  "name": "我的组件",
  "version": "1.0.0",
  "desc": "一句话描述",
  "icon": "🧩",
  "entry": "<!DOCTYPE html>...",  // 完整 HTML（内联 JS/CSS）
  "width": 6                    // 占格宽度 1-12（12=整行）
}
```

## 三、沙箱内可用能力

Widget 运行在 `sandbox="allow-scripts"` iframe 中（无同源、无 cookie、无顶层导航权限）：

| 能力 | 用法 |
|---|---|
| 持久存储 | `parent.postMessage({type:'state:get', key:'mykey'}, '*')` → 收 `{type:'state:value', value}` |
| 写状态 | `postMessage({type:'state:set', key:'mykey', value: {...}}, '*')` |
| 打开链接 | `postMessage({type:'navigate', url:'https://...'}, '*')` |
| toast 通知 | `postMessage({type:'notify', message:'...'}, '*')` |

单条状态 ≤ 64KB；URL 白名单外会被拦截。

## 四、最小示例：今日步数

```html
<!DOCTYPE html>
<html><body style="font-family:sans-serif;text-align:center;padding:20px">
  <div style="font-size:40px">🏃</div>
  <div id="v" style="font-size:28px;font-weight:700">0</div>
  <div style="font-size:12px;color:#888">今日步数（示例数据）</div>
  <script>
    const steps = 4000 + Math.floor(Math.random() * 3000);
    setTimeout(() => document.getElementById('v').textContent = steps.toLocaleString(), 300);
  </script>
</body></html>
```

## 五、安装与调试

1. 后台 → 🧩 Widget 市场 → 粘贴 manifest JSON → 安装
2. 编辑器 → 添加模块 → 选择你的 widget → 保存布局
3. 修改后重新粘贴同 id manifest 即为"更新"

## 六、最佳实践

- 自适应高度：内容变化后 `postMessage({type:'resize', height: document.body.scrollHeight}, '*')`
- 深色适配：`prefers-color-scheme` 媒体查询，或读 `postMessage({type:'theme'})`
- 错误兜底：所有 postMessage 用 try/catch 包裹
- 不要请求外部 CDN（保持零 CDN 原则，图标用 emoji/SVG data URI）

## 七、上架规范

- id 冲突时后安装者覆盖（提示"安装 / 更新"）
- entry 总大小 ≤ 300KB，状态单条 ≤ 64KB
- 禁止：顶层导航、访问父页面 DOM、外发用户数据
