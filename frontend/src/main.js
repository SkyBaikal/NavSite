import { createApp, ref, onMounted, onUnmounted, computed } from 'vue';
import { handleEasterEgg } from './eastereggs.js';

// ===== 主题引擎：Design Tokens → CSS Variables =====
function applyTheme(theme) {
  const root = document.documentElement;
  const defaults = {
    'color-bg': '#f7f4ee',
    'color-card': '#ffffff',
    'color-ink': '#1a2332',
    'color-muted': '#6b7280',
    'color-accent': '#0f766e',
    'color-line': '#e2ddd3',
    radius: '12px',
    gap: '16px',
    'font-family': "'LXGW WenKai', 'Noto Serif SC', Georgia, serif",
  };
  const t = { ...defaults, ...theme };
  for (const [k, v] of Object.entries(t)) root.style.setProperty(`--${k}`, v);
}

// ===== 工具函数 =====
function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }

// ===== 事件总线 =====
const listeners = {};
export const bus = {
  on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  emit(type, payload) { (listeners[type] || []).forEach(fn => fn(payload)); },
};

// ===== 轻提示 toast =====
const Toast = {
  setup() {
    const msg = ref('');
    let timer = null;
    bus.on('toast', m => {
      msg.value = m;
      clearTimeout(timer);
      timer = setTimeout(() => { msg.value = ''; }, 2200);
    });
    return { msg };
  },
  template: `<transition name="toast"><div v-if="msg" class="toast">{{ msg }}</div></transition>`,
};

// ===== API 封装 =====
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, credentials: 'same-origin' });
  const data = await res.json();
  if (data.code !== 'OK') throw new Error(data.message || data.code);
  return data.data;
}

// ===== Widgets 注册表 =====
const registry = {};

// -- searchbar widget --
registry.searchbar = {
  label: '搜索框',
  component: {
    props: ['widget'],
    setup(props) {
      const kw = ref('');
      const results = ref([]);
      const activeIdx = ref(-1);
      const engines = computed(() => {
        ver.value;
        const custom = window.__appearance?.searchEngines || [];
        return [
          { id: 'site', name: '站内' },
          ...(Array.isArray(custom) ? custom.filter(e => e && e.id && e.name && e.url).slice(0, 8) : []),
          { id: 'bing', name: '必应', url: 'https://www.bing.com/search?q=' },
          { id: 'gh', name: 'GitHub', url: 'https://github.com/search?q=' },
          { id: 'bili', name: 'B站', url: 'https://search.bilibili.com/all?keyword=' },
        ];
      });
      const engine = ref('site');
      let t = null;
      function doSearch() {
        if (engine.value !== 'site') return;
        clearTimeout(t);
        t = setTimeout(async () => {
          results.value = kw.value.trim() ? await api(`/api/links?kw=${encodeURIComponent(kw.value)}`) : [];
          activeIdx.value = -1;
        }, 150);
      }
      function go(r) { bus.emit('link.click', r); }
      function onKey(e) {
        if (engine.value !== 'site') return;
        if (e.key === 'ArrowDown') { activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { activeIdx.value = Math.max(activeIdx.value - 1, 0); e.preventDefault(); }
        else if (e.key === 'Enter') {
          if (engine.value !== 'site') {
            const eng = engines.find(x => x.id === engine.value);
            window.open(eng.url + encodeURIComponent(kw.value), '_blank');
          } else if (results.value[activeIdx.value]) go(results.value[activeIdx.value]);
          else if (results.value.length === 1) go(results.value[0]);
        }
      }
      function submit() {
        if (engine.value !== 'site') {
          const eng = engines.find(x => x.id === engine.value);
          window.open(eng.url + encodeURIComponent(kw.value), '_blank');
        }
      }
      const ver = ref(0);
      onMounted(() => window.addEventListener('appearance-ready', () => { ver.value++; }, { once: true }));
      const ph = computed(() => { ver.value; return props.widget?.props?.placeholder || window.__appearance?.searchPlaceholder || '搜点什么…'; });
      return { kw, results, activeIdx, engines, engine, doSearch, go, onKey, submit, ph };
    },
    template: `
      <div class="widget searchbar">
        <div class="search-row">
          <select v-model="engine" class="engine">
            <option v-for="e in engines" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
          <input v-model="kw" @input="doSearch" @keydown="onKey"
            :placeholder="ph" autofocus />
          <button @click="submit" v-if="engine!=='site'">搜</button>
        </div>
        <div class="results" v-if="engine==='site' && results.length">
          <div v-for="(r,i) in results" :key="r.id" class="result" :class="{active:i===activeIdx}"
            @click="go(r)" @mouseenter="activeIdx=i">
            <img :src="r.icon_url || fallbackIcon(r)" class="ricon" alt="">
            <span class="rtitle">{{ r.title }}</span>
            <span class="rdesc">{{ r.description }}</span>
          </div>
        </div>
        <div class="results" v-else-if="engine==='site' && kw && !results.length">
          <div class="empty">没有找到「{{ kw }}」，换个词试试？</div>
        </div>
      </div>
    `,
    methods: {
      fallbackIcon(r) { return '/api/favicon?host=' + encodeURIComponent(hostOf(r.url)); },
    },
  },
};

// -- category widget --
registry.category = {
  label: '链接分类',
  component: {
    props: ['widget', 'category'],
    setup(props) {
      const peeks = ref({});
      const peekCache = {};
      const peek = (link) => {
        if (peekCache[link.id] !== undefined) { peeks.value[link.id] = peekCache[link.id]; return; }
        peekCache[link.id] = null; // 占位，防重复请求
        fetch('/api/preview?url=' + encodeURIComponent(link.url))
          .then(r => r.json())
          .then(d => {
            if (d.code === 'OK' && d.data?.image) {
              peekCache[link.id] = d.data.image;
              peeks.value[link.id] = d.data.image;
            }
          })
          .catch(() => {});
      };
      const record = (link) => {
        bus.emit('link.click', link);
      };
      // 拖拽排序（登录态才生效：HttpOnly cookie 读不到，探测 /api/admin/me）
      const isAdmin = ref(false);
      const readonly = ref(false);
      onMounted(async () => {
        try {
          const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
          const d = await r.json();
          isAdmin.value = d.code === 'OK';
        } catch {}
      });
      const dragId = { v: null };
      function onDragStart(l, e) { dragId.v = l.id; try { e.dataTransfer.setData('text/plain', String(l.id)); e.dataTransfer.effectAllowed = 'move'; } catch {} }
      async function onDrop(l) {
        if (!isAdmin.value || dragId.v == null || dragId.v === l.id) return;
        const cat = props.category;
        const ids = cat.links.map(x => x.id);
        const from = ids.indexOf(dragId.v), to = ids.indexOf(l.id);
        if (from < 0 || to < 0) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        cat.links = ids.map((id, i) => ({ ...cat.links.find(x => x.id === id), sort_order: i }));
        dragId.v = null;
        try {
          await fetch('/api/admin/links/reorder', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orders: cat.links.map((x, i) => ({ id: x.id, sort_order: i })) }),
          });
          bus.emit('toast', '✓ 已保存排序');
        } catch {}
      }
      const q = ref('');
const expanded = ref(false);
const LIMIT = 12;
const allLinks = computed(() => props.category?.links || []);
const matched = computed(() => {
  const kw = q.value.trim().toLowerCase();
  return kw ? allLinks.value.filter(l => (l.title || '').toLowerCase().includes(kw) || (l.url || '').toLowerCase().includes(kw) || (l.description || '').toLowerCase().includes(kw)) : allLinks.value;
});
const filtered = computed(() => (expanded.value || q.value.trim()) ? matched.value : matched.value.slice(0, LIMIT));
const hiddenCount = computed(() => matched.value.length - filtered.value.length);
return { record, peek, peeks, onDragStart, onDrop, isAdmin, q, filtered, expanded, hiddenCount };
    },
    template: `
      <section class="widget category">
        <h2><span class="cicon">{{ category.icon }}</span>{{ category.name }}</h2>
        <input v-if="(category.links || []).length >= 8" v-model="q" class="cat-filter" placeholder="🔍 过滤本分类…" @click.stop @keydown.stop>
        <div v-if="q && !filtered.length" class="cat-nomatch">没有匹配的链接</div>
        <div class="cards" :class="'mode-' + (widget?.props?.mode || 'cards')">
          <a v-for="l in filtered" :key="l.id" class="card" :href="l.url" target="_blank" rel="noopener"
             @click="record(l)" @mouseenter="peek(l)"
             :draggable="isAdmin" @dragstart="onDragStart(l, $event)" @dragover.prevent @drop.prevent="onDrop(l)">
            <img class="card-icon" :src="l.icon_url || '/api/favicon?host=' + encodeURIComponent(hostname(l.url))" alt="" loading="lazy"
                 @error="hideIcon($event)">
            <div class="card-text">
              <span class="card-title">{{ l.title }}</span>
              <span class="card-desc" v-if="l.description">{{ l.description }}</span>
            </div>
            <div class="card-peek" v-if="peeks[l.id]">
              <img :src="peeks[l.id]" alt="" loading="lazy" @error="peeks[l.id] = null">
            </div>
          </a>
        </div>
        <button v-if="hiddenCount > 0" class="cat-more" @click="expanded = !expanded">{{ expanded ? '收起' : '展开其余 ' + hiddenCount + ' 个' }}</button>
      </section>
    `,
    methods: {
      hostname(u) { try { return new URL(u).hostname; } catch { return ''; } },
      hideIcon(e) { e.target.style.visibility = 'hidden'; },
    },
  },
};

// -- clock widget --
registry.clock = {
  label: '时钟',
  component: {
    props: ['widget'],
    setup() {
      const now = ref(new Date());
      const greeting = computed(() => {
        const h = now.value.getHours();
        if (h < 5) return '夜深了，注意休息';
        if (h < 9) return '早上好';
        if (h < 12) return '上午好';
        if (h < 14) return '中午好';
        if (h < 18) return '下午好';
        if (h < 23) return '晚上好';
        return '夜深了，注意休息';
      });
      let timer;
      const secFlip = ref(0), minFlip = ref(0);
      let lastSec = -1, lastMin = -1;
      onMounted(() => {
        timer = setInterval(() => {
          now.value = new Date();
          if (now.value.getSeconds() !== lastSec) { lastSec = now.value.getSeconds(); secFlip.value++; }
          if (now.value.getMinutes() !== lastMin) { lastMin = now.value.getMinutes(); minFlip.value++; }
        }, 1000);
      });
      const pad = n => String(n).padStart(2, '0');
      return { now, greeting, pad, secFlip, minFlip };
    },
    template: `
      <div class="widget clock">
        <div class="clock-time">{{ pad(now.getHours()) }}:{{ pad(now.getMinutes()) }}<span class="sec">:{{ pad(now.getSeconds()) }}</span></div>
        <div class="clock-date">{{ now.getFullYear() }}年{{ now.getMonth()+1 }}月{{ now.getDate() }}日 · 星期{{ '日一二三四五六'[now.getDay()] }}</div>
        <div class="clock-greet">{{ greeting }}</div>
      </div>
    `,
  },
};

// -- hitokoto widget（一言，本地内置句池，零外部请求）--
registry.hitokoto = {
  label: '一言',
  component: {
    props: ['widget'],
    setup() {
      const pool = [
        '凡是过往，皆为序章。', '我们的征途是星辰大海。', '大胆点，人生不过一场试错。',
        '把每一天过成自己的纪念版。', '慢慢来，比较快。', '种一棵树最好的时间是十年前，其次是现在。',
        '星光不问赶路人，时光不负有心人。', '独行快，众行远。', '你的时间有限，别浪费在重复别人的生活里。',
        '种草要趁早，拔草要趁好。', '梦里走了许多路，醒来还在床上，所以行动吧。',
      ];
      const text = ref(pool[Math.floor(Math.random() * pool.length)]);
      const next = () => { text.value = pool[Math.floor(Math.random() * pool.length)]; };
      return { text, next };
    },
    template: `
      <div class="widget hitokoto" @click="next" title="点击换一句">
        <div class="hitokoto-text">{{ text }}</div>
      </div>
    `,
  },
};

// -- quicknote widget（速记便签，存服务端）--
registry.quicknote = {
  label: '速记便签',
  component: {
    props: ['widget'],
    setup(props) {
      const text = ref(props.widget?.props?.text || '');
      const saved = ref('');
      let t = null;
      async function save() {
        clearTimeout(t);
        t = setTimeout(async () => {
          try {
            await fetch(`/api/widgets/${props.widget.id}/state`, {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: 'note', value: text.value }),
            });
            saved.value = '已保存 ' + new Date().toLocaleTimeString();
            setTimeout(() => (saved.value = ''), 2000);
          } catch {}
        }, 600);
      }
      onMounted(async () => {
        // 读取已存内容（widget 实例 id 在布局数据里）
        if (props.widget.id) {
          try {
            const r = await fetch(`/api/widgets/${props.widget.id}/state?key=note`, { credentials: 'same-origin' });
            const d = await r.json();
            if (d.code === 'OK' && d.data && !text.value) text.value = d.data;
          } catch {}
        }
      });
      // 流转：把以「#todo 」开头的行转待办、「#link 名称|网址」转链接
      const converting = ref(false);
      async function convert() {
        if (converting.value) return;
        converting.value = true;
        try {
          const lines = text.value.split('\n');
          const remain = [];
          let todos = 0, links = 0;
          for (const ln of lines) {
            const s = ln.trim();
            const td = s.match(/^#todo\s+(.+)/i);
            if (td) {
              window.dispatchEvent(new CustomEvent('quickTodoAdd', { detail: td[1] }));
              todos++; continue;
            }
            const lk = s.match(/^#link\s+(.+?)\s*[|｜]\s*(https?:\/\/\S+)/i);
            if (lk) {
              await fetch('/api/quick-link', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: lk[1], url: lk[2] }) }).catch(() => {});
              links++; continue;
            }
            remain.push(ln);
          }
          if (todos || links) {
            text.value = remain.join('\n');
            saved.value = `已流转：待办×${todos} 链接×${links}`;
            setTimeout(() => (saved.value = ''), 3000);
          } else {
            saved.value = '没有可流转的行（#todo 文本 / #link 名称|网址）';
            setTimeout(() => (saved.value = ''), 3000);
          }
        } finally { converting.value = false; }
      }
      return { text, saved, save, convert, converting };
    },
    template: `
      <div class="widget quicknote">
        <textarea v-model="text" @input="save" placeholder="随手记点什么…（自动保存）"></textarea>
        <div class="note-saved">{{ saved }}</div>
        <button class="note-convert" @click="convert" :disabled="converting" title="把 #todo / #link 行流转到对应 widget">⇄ 流转</button>
      </div>
    `,
  },
};

// 打卡历史热力图：取最近 90 天 user_state 快照
// 后端在打卡时同时写 history 快照（key=habit_history），前端渲染 GitHub 风格格子

// -- habit widget（习惯打卡，存服务端）--
registry.habit = {
  label: '习惯打卡',
  component: {
    props: ['widget'],
    setup(props) {
      const habits = ref((props.widget?.props?.habits || ['喝水', '背单词']).map((name, i) => ({
        name, id: 'h' + i, done: false, streak: 0,
      })));
      const today = new Date().toDateString();
      onMounted(async () => {
        if (!props.widget?.id) return;
        loadHistory();
        try {
          const r = await fetch(`/api/widgets/${props.widget.id}/state?key=habit`, { credentials: 'same-origin' });
          const d = await r.json();
          if (d.code === 'OK' && d.data) {
            const saved = d.data;
            if (saved.date !== today) {
              // 新的一天：重置 done，更新连续天数（昨天打过则 +1，否则归零）
              habits.value.forEach(h => {
                const s = saved.streaks?.[h.id] || { last: '', n: 0 };
                const yest = new Date(Date.now() - 86400000).toDateString();
                h.streak = (s.last === yest && s.n > 0) ? s.n : 0;
              });
            } else {
              habits.value.forEach(h => {
                h.done = !!saved.done?.[h.id];
                h.streak = saved.streaks?.[h.id]?.n || 0;
              });
            }
          }
        } catch {}
      });
      async function toggle(h) {
        h.done = !h.done;
        h.streak = h.done ? h.streak + 1 : Math.max(0, h.streak - 1);
        const payload = {
          date: today,
          done: Object.fromEntries(habits.value.map(x => [x.id, x.done])),
          streaks: Object.fromEntries(habits.value.map(x => [x.id, { last: today, n: x.streak }])),
        };
        try {
          await fetch(`/api/widgets/${props.widget.id}/state`, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: 'habit', value: payload }),
          });
          loadHistory();
        } catch {}
      }
      // 热力图：最近 12 周 × 7 天
      const heat = ref([]);
      async function loadHistory() {
        if (!props.widget?.id) return;
        try {
          const r = await fetch(`/api/widgets/${props.widget.id}/history`, { credentials: 'same-origin' });
          const d = await r.json();
          const hist = d.data || {};
          const days = [];
          const now = new Date();
          const start = new Date(now.getTime() - 83 * 86400000);
          // 从 start 所在周的周一开始
          start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
          for (let i = 0; i < 84; i++) {
            const dt = new Date(start.getTime() + i * 86400000);
            const key = dt.toISOString().slice(0, 10); // ISO 日期，与后端快照 key 一致
            const entry = hist[key];
            days.push({
              key,
              level: entry ? Math.min(3, entry.count) : 0, // 0-3 格子深浅
              future: dt > now,
            });
          }
          // 转成 12 列（周）× 7 行
          const weeks = [];
          for (let w = 0; w < 12; w++) weeks.push(days.slice(w * 7, w * 7 + 7));
          heat.value = weeks;
        } catch {}
      }
      return { habits, toggle, heat };
    },
    template: `
    <div class="widget habit">
      <div v-for="h in habits" :key="h.id" class="habit-row" @click="toggle(h)" :class="{done: h.done}">
        <span class="habit-check">{{ h.done ? '✓' : '' }}</span>
        <span class="habit-name">{{ h.name }}</span>
        <span class="habit-streak" v-if="h.streak">🔥{{ h.streak }}天</span>
      </div>
      <div class="heatmap" v-if="heat.length">
        <div class="heat-week" v-for="(week, wi) in heat" :key="wi">
          <span v-for="d in week" :key="d.key" class="heat-cell" :class="'lv' + d.level" :title="d.key" :style="d.future ? 'visibility:hidden' : ''"></span>
        </div>
      </div>
    </div>
    `,
  },
};

// -- rss widget（RSS 订阅摘要）--
registry.rss = {
  label: 'RSS 订阅',
  component: {
    props: ['widget'],
    setup(props) {
      const items = ref([]);
      const status = ref('加载中…');
      const url = props.widget?.props?.feed || props.widget?.props?.url || 'https://hnrss.org/frontpage';
      const maxItems = props.widget?.props?.limit || 8;
      onMounted(async () => {
        try {
          const r = await fetch('/api/rss?u=' + encodeURIComponent(url));
          const d = await r.json();
          if (d.code === 'OK') { items.value = d.data; status.value = ''; }
          else status.value = '抓取失败';
        } catch { status.value = '网络错误'; }
      });
      const fmtDate = (s) => {
        try {
          const d = new Date(s); if (isNaN(d)) return s.slice(0, 10);
          const now = new Date(); const day = 86400_000;
          const diff = Math.floor((now - d) / day);
          if (diff <= 0) {
            const hrs = Math.floor((now - d) / 3600_000);
            if (hrs < 1) return Math.max(1, Math.floor((now - d) / 60_000)) + ' 分钟前';
            return hrs + ' 小时前';
          }
          if (diff === 1) return '昨天';
          if (diff < 7) return diff + ' 天前';
          return (d.getMonth() + 1) + '月' + d.getDate() + '日';
        } catch { return s.slice(0, 10); }
      };
      return { items, status, maxItems, fmtDate };
    },
    template: `
      <div class="widget rss">
        <div v-if="status" class="rss-status">{{ status }}</div>
        <a v-for="it in items.slice(0, maxItems)" :key="it.link" class="rss-item" :href="it.link" target="_blank" rel="noopener">
          <span class="rss-title">{{ it.title }}</span>
          <span class="rss-date" v-if="it.date">{{ fmtDate(it.date) }}</span>
        </a>
      </div>
    `,
  },
};

// -- weather widget（天气）--
registry.weather = {
  label: '天气',
  component: {
    props: ['widget'],
    setup(props) {
      const w = ref(null);
      const status = ref('加载中…');
      const stale = ref(false);
      const city = props.widget?.props?.city || 'Beijing';
      onMounted(async () => {
        try {
          const r = await fetch('/api/weather?city=' + encodeURIComponent(city));
          const d = await r.json();
          if (d.code === 'OK' && d.data) { w.value = d.data; status.value = ''; }
          else status.value = '获取失败';
        } catch { status.value = '网络错误'; }
        upstreamStatus('wttr.in').then(s => { stale.value = s === 'stale'; });
      });
      return { w, status, stale };
    },
    template: `
      <div class="widget weather">
        <span v-if="stale" class="stale-badge" title="数据源暂时不可用，显示缓存数据">📴 离线数据</span>
        <div v-if="w" class="weather-body">
          <span class="weather-icon">{{ w.icon }}</span>
          <div class="weather-main">
            <span class="weather-temp">{{ w.temp }}°C</span>
            <span class="weather-city">{{ w.city }} · 体感 {{ w.feels }}°C · 湿度 {{ w.humidity }}%</span>
          </div>
          <span class="weather-desc">{{ w.desc }}</span>
        </div>
        <div v-else class="weather-status">{{ status }}</div>
      </div>
    `,
  },
};

// -- dailyshot widget（每日一图）--
registry.dailyshot = {
  label: '每日一图',
  component: {
    props: ['widget'],
    setup() {
      const shot = ref(null);
      const status = ref('加载中…');
      const stale = ref(false);
      onMounted(async () => {
        try {
          const r = await fetch('/api/dailyshot');
          const d = await r.json();
          if (d.code === 'OK' && d.data) { shot.value = d.data; status.value = ''; }
          else status.value = '获取失败';
        } catch { status.value = '网络错误'; }
        upstreamStatus('bing').then(s => { stale.value = s === 'stale'; });
      });
      return { shot, status, stale };
    },
    template: `
      <div class="widget dailyshot">
        <span v-if="stale" class="stale-badge" title="数据源暂时不可用，显示缓存数据">📴 离线数据</span>
        <div v-if="shot" class="shot-wrap">
          <img :src="shot.url" alt="" loading="lazy" @load="$el && null">
          <div class="shot-cap">
            <span class="shot-title">{{ shot.title }}</span>
            <span class="shot-copy">{{ shot.copyright }}</span>
          </div>
        </div>
        <div v-else class="shot-status">{{ status }}</div>
      </div>
    `,
  },
};

// -- countdown widget（倒计时，存服务端 settings）--
registry.countdown = {
  label: '倒计时',
  component: {
    props: ['widget'],
    setup(props) {
      const list = ref([]);
      const status = ref('');
      const mode = ref(props.widget?.props?.mode || 'nearest'); // nearest=只显示最近一个, all=全列表
      let timer = null;
      const daysLeft = (date) => Math.ceil((new Date(date + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
      async function load() {
        try { const d = await fetch('/api/countdowns').then(r => r.json()); list.value = d.data || []; } catch {}
      }
      async function add() {
        const title = prompt('倒计时标题（如：生日 / 发布会）：'); if (!title) return;
        const date = prompt('目标日期（YYYY-MM-DD，如 2026-12-25）：'); if (!date) return;
        const r = await fetch('/api/countdowns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, date }) });
        const d = await r.json();
        if (d.code !== 'OK') status.value = d.message; else { status.value = ''; await load(); }
      }
      async function del(id) {
        if (!confirm('删除该倒计时？')) return;
        await fetch('/api/countdowns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', title: id }) });
        await load();
      }
      onMounted(() => { load(); timer = setInterval(load, 60000); });
      onUnmounted(() => clearInterval(timer));
      const sorted = computed(() => [...list.value].sort((a, b) => daysLeft(a.date) - daysLeft(b.date)));
      return { list, sorted, daysLeft, add, del, status, mode };
    },
    template: `
      <div class="widget countdown">
        <div class="cd-head">
          <span class="cd-title">⏳ 倒计时</span>
          <button class="cd-add" @click="add" title="添加倒计时">＋</button>
        </div>
        <div v-if="!sorted.length" class="cd-empty">还没有倒计时，点 ＋ 添加</div>
        <div v-else-if="mode === 'nearest'" class="cd-nearest">
          <span class="cd-name">{{ sorted[0].title }}</span>
          <span class="cd-days" :class="{ 'cd-soon': daysLeft(sorted[0].date) <= 7 }">
            {{ daysLeft(sorted[0].date) > 0 ? '还有 ' + daysLeft(sorted[0].date) + ' 天' : (daysLeft(sorted[0].date) === 0 ? '就是今天！🎉' : '已过 ' + (-daysLeft(sorted[0].date)) + ' 天') }}
          </span>
          <span class="cd-date">{{ sorted[0].date }}</span>
        </div>
        <ul v-else class="cd-list">
          <li v-for="c in sorted" :key="c.id" @click="del(c.id)" title="点击删除">
            <span class="cd-name">{{ c.title }}</span>
            <span class="cd-days" :class="{ 'cd-soon': daysLeft(c.date) <= 7 }">{{ daysLeft(c.date) }}天</span>
          </li>
        </ul>
      </div>
    `,
  },
};

// -- recent widget（最近访问，取 link.click 事件流）--
registry.recent = {
  label: '最近访问',
  component: {
    props: ['widget'],
    setup(props) {
      const items = ref([]);
      const status = ref('加载中…');
      const maxItems = props.widget?.props?.limit || 8;
      const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
      onMounted(async () => {
        try {
          const d = await fetch('/api/links/recent').then(r => r.json());
          items.value = (d.data || []).slice(0, maxItems).map(it => ({ ...it, host: hostOf(it.url) }));
          if (!items.value.length) status.value = '还没有点击记录，去点几个卡片吧';
        } catch { status.value = '加载失败'; }
      });
      return { items, status };
    },
    template: `
      <div class="widget recent">
        <div class="rc-head">🕒 最近访问</div>
        <div v-if="!items.length" class="rc-empty">{{ status }}</div>
        <ul v-else class="rc-list">
          <li v-for="it in items" :key="it.id">
            <a :href="it.url" target="_blank" rel="noopener">
              <img :src="it.icon_url || ('/api/favicon?host=' + encodeURIComponent(it.host))" class="rc-icon" alt="">
              <span class="rc-title">{{ it.title }}</span>
            </a>
          </li>
        </ul>
      </div>
    `,
  },
};

// -- quote widget（句子收藏，本地 user_state，零外部依赖）--
registry.quote = {
  label: '句子收藏',
  component: {
    props: ['widget'],
    setup(props) {
      const wid = props.widget?.id || 'quote';
      const quotes = ref([]);
      const status = ref('');
      async function load() {
        const d = await fetch(`/api/widgets/${wid}/state?key=quotes`).then(r => r.json());
        quotes.value = d.data || [];
      }
      async function add() {
        const text = prompt('收藏一句话：'); if (!text) return;
        const from = prompt('来源/作者（可留空）：') || '';
        const next = [...quotes.value, { id: Date.now().toString(36), text: text.slice(0, 120), from: from.slice(0, 40) }].slice(-50);
        await fetch(`/api/widgets/${wid}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'quotes', value: next }) });
        quotes.value = next;
      }
      async function del(id) {
        const next = quotes.value.filter(q => q.id !== id);
        await fetch(`/api/widgets/${wid}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'quotes', value: next }) });
        quotes.value = next;
      }
      onMounted(load);
      const idx = ref(0);
      return { quotes, add, del, idx, status };
    },
    template: `
      <div class="widget quote">
        <div class="qt-head">
          <span>✒️ 句子收藏</span>
          <span class="qt-nav">
            <button class="qt-btn" @click="idx = (idx + quotes.length - 1) % quotes.length" v-if="quotes.length">‹</button>
            <button class="qt-btn" @click="add" title="收藏新句子">＋</button>
            <button class="qt-btn" @click="idx = (idx + 1) % quotes.length" v-if="quotes.length">›</button>
          </span>
        </div>
        <div v-if="!quotes.length" class="qt-empty">点 ＋ 收藏第一句话</div>
        <blockquote v-else class="qt-body" @dblclick="del(quotes[idx].id)" title="双击删除">
          <p class="qt-text">{{ quotes[idx].text }}</p>
          <cite v-if="quotes[idx].from" class="qt-from">—— {{ quotes[idx].from }}</cite>
        </blockquote>
      </div>
    `,
  },
};


// -- calendar widget（迷你日历+农历，纯算法零外部依赖）--
// 农历数据（2020-2060，由 cnlunar 库权威生成；bits: bit(m-1)=1 表示 30 天；CNY 春节公历锚点）
const LUNAR_TB = {"2020":[2718,4,0],"2021":[1366,0,0],"2022":[2741,0,0],"2023":[2778,2,0],"2024":[1746,0,0],"2025":[1893,6,0],"2026":[1829,0,0],"2027":[1611,0,0],"2028":[1623,5,0],"2029":[3243,0,0],"2030":[1370,0,0],"2031":[1390,3,0],"2032":[2921,0,0],"2033":[3922,11,0],"2034":[2898,0,0],"2035":[2853,0,0],"2036":[3339,6,1],"2037":[2635,0,0],"2038":[1195,0,0],"2039":[699,5,0],"2040":[1453,0,0],"2041":[2922,0,0],"2042":[3498,2,0],"2043":[3474,0,0],"2044":[3749,7,0],"2045":[3365,0,0],"2046":[2645,0,0],"2047":[2637,5,1],"2048":[1206,0,0],"2049":[1461,0,0],"2050":[1746,3,1],"2051":[3785,0,0],"2052":[3986,8,0],"2053":[3730,0,0],"2054":[3366,0,0],"2055":[1302,6,1],"2056":[2647,0,0],"2057":[1366,0,0],"2058":[869,4,1],"2059":[1877,0,0],"2060":[1865,0,0]};
const CNY = {"2020":"01-25","2021":"02-12","2022":"02-01","2023":"01-22","2024":"02-10","2025":"01-29","2026":"02-17","2027":"02-06","2028":"01-26","2029":"02-13","2030":"02-03","2031":"01-23","2032":"02-11","2033":"01-31","2034":"02-19","2035":"02-08","2036":"01-28","2037":"02-15","2038":"02-04","2039":"01-24","2040":"02-12","2041":"02-01","2042":"01-22","2043":"02-10","2044":"01-30","2045":"02-17","2046":"02-06","2047":"01-26","2048":"02-14","2049":"02-02","2050":"01-23","2051":"02-11","2052":"02-01","2053":"02-19","2054":"02-08","2055":"01-28","2056":"02-15","2057":"02-04","2058":"01-24","2059":"02-12","2060":"02-02","2061":"02-21"};
const LUNAR_MONTHS = '正二三四五六七八九十冬腊';
const LUNAR_DAYS = '初一初二初三初四初五初六初七初八初九初十十一十二十三十四十五十六十七十八十九二十廿一廿二廿三廿四廿五廿六廿七廿八廿九三十';
function solarToLunar(dt) {
  const y = dt.getFullYear();
  let ly = y;
  const cnyOf = yy => new Date(yy + '-' + (CNY[String(yy)] || '02-15') + 'T00:00:00');
  if (dt < cnyOf(ly)) ly--;
  const start = cnyOf(ly);
  let off = Math.floor((Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
  const [bits, leapNum, leapBig] = LUNAR_TB[String(ly)] || [0, 0, 0];
  const md = m => (bits & (1 << (m - 1))) ? 30 : 29;
  let m = 1, isLeap = false;
  for (;;) {
    if (leapNum && m === leapNum + 1 && !isLeap) {
      const ld = leapBig ? 30 : 29;
      if (off < ld) { isLeap = true; m = leapNum; break; }
      off -= ld;
    }
    const dd = md(m);
    if (off < dd) break;
    off -= dd;
    m++;
  }
  return { y: ly, m, d: off + 1, leap: isLeap };
}
function lunarDayText(d) {
  const l = solarToLunar(d);
  return (l.leap ? '闰' : '') + LUNAR_MONTHS[l.m - 1] + '月' + LUNAR_DAYS.substr((l.d - 1) * 2, 2);
}
registry.calendar = {
  label: '迷你日历',
  component: {
    props: ['widget'],
    setup() {
      const now = new Date();
      const y = now.getFullYear(), mo = now.getMonth();
      const first = new Date(y, mo, 1).getDay();
      const days = new Date(y, mo + 1, 0).getDate();
      const today = now.getDate();
      const cells = [];
      for (let i = 0; i < first; i++) cells.push(null);
      for (let d = 1; d <= days; d++) cells.push(d);
      const monthName = `${y} 年 ${mo + 1} 月`;
      const lunarToday = lunarDayText(now);
      return { cells, today, monthName, lunarToday, lunarDayText };
    },
    template: `
      <div class="widget minical">
        <div class="cal-head"><span class="cal-month">{{ monthName }}</span><span class="cal-lunar">{{ lunarToday }}</span></div>
        <div class="cal-grid">
          <span v-for="(w, i) in ['日','一','二','三','四','五','六']" :key="'w'+i" class="cal-wd">{{ w }}</span>
          <span v-for="(c, i) in cells" :key="'c'+i" class="cal-cell" :class="{ today: c === today, empty: !c }">{{ c || '' }}</span>
        </div>
      </div>
    `,
  },
};

// -- todo widget（待办清单）--
registry.todo = {
  label: '待办清单',
  component: {
    props: ['widget'],
    setup(props) {
      const wid = props.widget?.id || 'todo';
      const todos = ref([]);
      const draft = ref('');
      const filter = ref('all');
      async function load() {
        const d = await fetch(`/api/widgets/${wid}/state?key=todos`).then(r => r.json());
        todos.value = d.data || [];
      }
      // 速记流转：接收 #todo 行
      window.addEventListener('quickTodoAdd', (e) => {
        todos.value.push({ text: e.detail, done: false, created: Date.now() });
        save();
      });
      async function save() {
        await fetch(`/api/widgets/${wid}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'todos', value: todos.value }) });
      }
      async function add() {
        const t = draft.value.trim(); if (!t) return;
        todos.value = [...todos.value, { id: Date.now().toString(36), text: t.slice(0, 80), done: false, at: Date.now() }].slice(-100);
        draft.value = '';
        await save();
      }
      async function toggle(id) {
        const it = todos.value.find(t => t.id === id); if (!it) return;
        it.done = !it.done;
        await save();
      }
      async function del(id) {
        todos.value = todos.value.filter(t => t.id !== id);
        await save();
      }
      const focusId = ref('');
      async function setFocus(id) {
        focusId.value = focusId.value === id ? '' : id;
        localStorage.setItem('navsite.todoFocus', focusId.value);
      }
      focusId.value = localStorage.getItem('navsite.todoFocus') || '';
      bus.on('pomodoroDone', async () => {
        if (!focusId.value) return;
        const it = todos.value.find(t => t.id === focusId.value && !t.done);
        if (it) { it.done = true; await save(); bus.emit('toast', '⭐ 专注项已完成：' + it.text); }
        focusId.value = ''; localStorage.removeItem('navsite.todoFocus');
      });
      async function clearDone() {
        todos.value = todos.value.filter(t => !t.done);
        await save();
      }
      const shown = computed(() => filter.value === 'active' ? todos.value.filter(t => !t.done) : filter.value === 'done' ? todos.value.filter(t => t.done) : todos.value);
      const left = computed(() => todos.value.filter(t => !t.done).length);
      onMounted(load);
      return { todos, draft, filter, shown, left, add, toggle, del, clearDone, focusId, setFocus };
    },
    template: `
      <div class="widget todo">
        <div class="td-head">
          <span>📝 待办清单 <b v-if="left" class="td-count">{{ left }}</b></span>
          <span class="td-filters">
            <button :class="{on: filter==='all'}" @click="filter='all'">全部</button>
            <button :class="{on: filter==='active'}" @click="filter='active'">进行</button>
            <button :class="{on: filter==='done'}" @click="filter='done'">完成</button>
          </span>
        </div>
        <form class="td-add" @submit.prevent="add">
          <input v-model="draft" placeholder="加一件要做的事…" maxlength="80">
        </form>
        <div v-if="!todos.length" class="td-empty">还没有待办，输入框里写一条吧</div>
        <div class="td-list" v-else>
          <div v-for="t in shown" :key="t.id" class="td-item" :class="{done: t.done}">
            <span class="td-check" @click="toggle(t.id)">{{ t.done ? '✓' : '' }}</span>
            <span class="td-text" @click="toggle(t.id)" :class="{focus: t.id===focusId}">{{ t.text }}</span>
            <button class="td-star" @click="setFocus(t.id)" :title="t.id===focusId ? '取消专注' : '设为专注项'">{{ t.id===focusId ? '⭐' : '☆' }}</button>
            <button class="td-del" @click="del(t.id)" title="删除">✕</button>
          </div>
        </div>
        <button class="td-clear" v-if="todos.some(t=>t.done)" @click="clearDone">清除已完成</button>
      </div>
    `,
  },
};

// -- pomodoro widget（番茄钟）--
registry.pomodoro = {
  label: '番茄钟',
  component: {
    props: ['widget'],
    setup(props) {
      const FOCUS = (Number(props.widget?.props?.focusMin) || 25) * 60;
      const REST = (Number(props.widget?.props?.restMin) || 5) * 60;
      const mode = ref('focus');
      const left = ref(FOCUS);
      const running = ref(false);
      const rounds = ref(0);
      const dayKey = new Date().toDateString();
      let timer = null;
      // 今日番茄数持久化（跨刷新保留，跨天自动归零）
      onMounted(async () => {
        const wid = props.widget?.id; if (!wid) return;
        try {
          const d = await fetch(`/api/widgets/${wid}/state?key=pomodoro`).then(r => r.json());
          if (d.data?.day === dayKey) rounds.value = d.data.rounds || 0;
        } catch {}
      });
      async function saveRounds() {
        const wid = props.widget?.id; if (!wid) return;
        try { await fetch(`/api/widgets/${wid}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'pomodoro', value: { day: dayKey, rounds: rounds.value } }) }); } catch {}
      }
      const mmss = computed(() => {
        const m = Math.floor(left.value / 60), s = left.value % 60;
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      });
      const pct = computed(() => mode.value === 'focus' ? 1 - left.value / FOCUS : 1 - left.value / REST);
      function tick() {
        left.value--;
        if (left.value <= 0) {
          if (mode.value === 'focus') { mode.value = 'rest'; left.value = REST; rounds.value++; bus.emit('toast', '🍅 番茄完成！休息 5 分钟'); bus.emit('pomodoroDone'); SoundFX.ding?.(); saveRounds(); }
          else { mode.value = 'focus'; left.value = FOCUS; running.value = false; clearInterval(timer); bus.emit('toast', '☀️ 休息结束，开工！'); }
        }
      }
      function toggleRun() {
        running.value = !running.value;
        if (running.value) timer = setInterval(tick, 1000);
        else clearInterval(timer);
      }
      function reset() { running.value = false; clearInterval(timer); mode.value = 'focus'; left.value = FOCUS; rounds.value = 0; saveRounds(); }
      onUnmounted(() => clearInterval(timer));
      return { mode, left, running, rounds, mmss, pct, toggleRun, reset };
    },
    template: `
      <div class="widget pomodoro" :class="'pd-' + mode">
        <div class="pd-head"><span>{{ mode === 'focus' ? '🍅 专注中' : '☕ 休息中' }}</span><span class="pd-rounds" v-if="rounds">已完成 {{ rounds }} 🍅</span></div>
        <div class="pd-ring" @click="toggleRun" :title="running ? '点击暂停' : '点击开始'">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" class="pd-track"/><circle cx="50" cy="50" r="45" class="pd-bar" :style="{strokeDashoffset: 283 * (1 - pct)}"/></svg>
          <span class="pd-time">{{ mmss }}</span>
        </div>
        <div class="pd-ops">
          <button @click="toggleRun">{{ running ? '⏸ 暂停' : '▶ 开始' }}</button>
          <button @click="reset" class="ghost">↺ 重置</button>
        </div>
      </div>
    `,
  },
};

// ===== 亮暗主题一键切换（🌓）=====
function isDarkBg() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
  const m = bg.match(/^#([0-9a-f]{2})/i);
  return m ? parseInt(m[1], 16) < 80 : false;
}
function mountThemeToggle() {
  const btn = document.createElement('button');
  btn.id = 'themeToggle';
  btn.title = '亮/暗主题切换';
  btn.textContent = isDarkBg() ? '☀️' : '🌙';
  btn.style.cssText = 'position:fixed;right:20px;bottom:52px;backdrop-filter:blur(8px);background:color-mix(in srgb, var(--color-card) 82%, transparent);z-index:80;width:44px;height:44px;border-radius:50%;border:1px solid var(--color-line);background:var(--color-card);color:var(--color-ink);font-size:20px;cursor:pointer;box-shadow:var(--shadow-pop);transition:transform .2s';
  btn.onmouseenter = () => btn.style.transform = 'scale(1.12)';
  btn.onmouseleave = () => btn.style.transform = '';
  btn.onclick = async () => {
    try {
      const r = await fetch('/api/theme/toggle', { method: 'POST' });
      const d = await r.json();
      if (d.code === 'OK' && d.data?.tokens) {
        applyTheme(d.data.tokens);
        btn.textContent = d.data.mode === 'dark' ? '☀️' : '🌙';
        showToast(d.data.mode === 'dark' ? '🎨 已切换到暗夜模式' : '🎨 已切换到纸墨模式');
      }
    } catch { showToast('⚠️ 切换失败'); }
  };
  document.body.appendChild(btn);
}
// 模块级直接挂载（onMounted 仅限组件 setup 内）
// Live 动态壁纸：canvas 流体 blob（沿用曜石六色系；reduced-motion 或手动关则静止）
  (function liveWall() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (localStorage.getItem('ns.liveWall') === 'off') return;
    const c = document.createElement('canvas');
    c.id = 'liveWall';
    document.body.prepend(c);
    const ctx = c.getContext('2d');
    let W, H;
    const fit = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
    fit(); addEventListener('resize', fit);
    const PALETTES = [
      [[45,212,191],[139,92,246]],   // 曜石青紫
      [[124,58,237],[236,72,153]],   // 紫夜
      [[20,184,166],[59,130,246]],   // 深海
      [[245,158,11],[239,68,68]],    // 琥珀
      [[96,165,250],[14,165,233]],   // 极地
      [[244,114,182],[167,139,250]], // 玫瑰夜
    ];
    const pal = PALETTES[Math.floor(Date.now() / 86400_000) % PALETTES.length];
    const blobs = Array.from({ length: 3 }, (_, i) => ({
      x: Math.random(), y: Math.random(),
      r: .35 + Math.random() * .25,
      dx: (Math.random() - .5) * .0004, dy: (Math.random() - .5) * .0004,
      col: pal[i % 2],
    }));
    let t = 0, running = true;
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(draw); });
    function draw() {
      if (!running) return;
      t++;
      ctx.fillStyle = 'rgba(11,14,20,.08)';
      ctx.fillRect(0, 0, W, H);
      for (const b of blobs) {
        b.x += b.dx; b.y += b.dy;
        if (b.x < -.2 || b.x > 1.2) b.dx *= -1;
        if (b.y < -.2 || b.y > 1.2) b.dy *= -1;
        const g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, b.r * Math.min(W, H));
        g.addColorStop(0, `rgba(${b.col[0]},${b.col[1]},${b.col[2]},${0.10 + 0.04 * Math.sin(t / 90)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      if (t % 240 === 0) window.__navsite?.liveWallFrame?.(); // 钩子（外部可暂停）
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    window.__navsite = window.__navsite || {};
    window.__navsite.liveWall = {
      toggle() {
        const off = c.classList.toggle('off');
        localStorage.setItem('ns.liveWall', off ? 'off' : 'on');
        return !off;
      },
      get on() { return !c.classList.contains('off'); },
    };
  })();
  // 开机 HUD 启动序列
  (function boot() {
    if (sessionStorage.getItem('ns.booted')) return;
    sessionStorage.setItem('ns.booted', '1');
    const d = document.createElement('div');
    d.id = 'bootScreen';
    d.innerHTML = '<div style="text-align:center"><div class="boot-logo">NAV·SITE</div><div class="boot-line"></div><div class="boot-sub">SYSTEM READY</div></div>';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  })();
  // 提醒引擎：倒计时临近 + RSS 新文章（每 10 分钟）
  setInterval(async () => {
    try {
      const cd = await fetch('/api/countdowns').then(r => r.json());
      for (const c of (cd.data || [])) {
        if (!c.date) continue;
        const diff = (new Date(c.date) - new Date()) / 3600000;
        const key = 'ns.remind.' + (c.id || c.title);
        if (diff > 0 && diff < 24 && localStorage.getItem(key) !== 'd1') {
          showToast(`⏳ 倒计时「${c.title}」不足 24 小时！`);
          localStorage.setItem(key, 'd1');
        }
      }
      // RSS 新文章（首个 feed 对比顶条目）
      const rssW = (await fetch('/api/spaces').then(r => r.json())).data?.[0];
      const lay = typeof rssW?.layout_json === 'string' ? JSON.parse(rssW.layout_json) : rssW?.layout_json || [];
      const rssItem = lay.find(w => w.type === 'rss');
      if (rssItem?.props?.feed) {
        const fd = await fetch(`/api/rss?url=${encodeURIComponent(rssItem.props.feed)}`).then(r => r.json());
        const firstTitle = fd.data?.items?.[0]?.title;
        if (firstTitle) {
          const rk = 'ns.rss.last';
          const prev = localStorage.getItem(rk);
          if (prev && prev !== firstTitle) showToast(`📰 RSS 有新文章：${firstTitle.slice(0, 24)}…`);
          localStorage.setItem(rk, firstTitle);
        }
      }
    } catch {}
  }, 600000);
  // 智能空间切换：switch_rule {mode:'schedule',start:'09:00',end:'18:00'} 每分钟检查
  setInterval(() => {
    try {
      const list = spaces.value || [];
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();
      for (const s of list) {
        let rule = s.switch_rule;
        if (typeof rule === 'string') { try { rule = JSON.parse(rule); } catch {} }
        if (!rule || rule.mode !== 'schedule' || !rule.start || !rule.end) continue;
        const [sh, sm] = String(rule.start).split(':').map(Number);
        const [eh, em] = String(rule.end).split(':').map(Number);
        const a = sh * 60 + sm, b = eh * 60 + em;
        const inRange = a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b);
        if (inRange && currentSpace.value !== s.id) { loadSpace(s.id); showToast(`⏰ 已按时段切换到「${s.name}」`); break; }
      }
    } catch {}
  }, 60000);
  // 本地艺术壁纸：按日期轮换 /art/wallpapers/ 六张
  (function setWallpaper() {
    const walls = ['obsidian','violet','abyss','ember','polar','rose'];
    const day = Math.floor(Date.now() / 86400000);
    const w = walls[day % walls.length];
    document.documentElement.style.setProperty('--wall', `url(/art/wallpapers/${w}.jpg)`);
  })();
  // 每日一图视差滚动
  window.addEventListener('scroll', () => {
    const imgs = document.querySelectorAll('.shot-wrap img');
    const y = window.scrollY;
    imgs.forEach(img => { img.style.transform = `translateY(${Math.min(y * 0.06, 60)}px) scale(1.08)`; });
  }, { passive: true });
  // 时段副语（hero 一句话）
  (function setDaypartLine() {
    const lines = {
      dawn: '晨光正好，宜启程', day: '日头正盛，专注当下', dusk: '暮色四合，适合收尾今天的事',
      night: '夜深了，网页会记住你今晚的足迹'
    };
    const apply = () => {
      const g = document.querySelector('.clock-greet');
      if (!g || document.querySelector('.daypart-line')) return;
      const h = new Date().getHours();
      const part = h >= 5 && h < 9 ? 'dawn' : h >= 9 && h < 17 ? 'day' : h >= 17 && h < 21 ? 'dusk' : 'night';
      const el = document.createElement('div');
      el.className = 'daypart-line';
      el.textContent = lines[part];
      g.parentElement.appendChild(el);
    };
    setTimeout(apply, 600);
  })();
  // 时段主题：按当前小时打标（dawn 5-9 / day 9-17 / dusk 17-21 / night 21-5）
  (function setDaypart() {
    const h = new Date().getHours();
    const part = h >= 5 && h < 9 ? 'dawn' : h >= 9 && h < 17 ? 'day' : h >= 17 && h < 21 ? 'dusk' : 'night';
    document.body.dataset.daypart = part;
    // 跨时段自动更新（每 10 分钟检查）
    setInterval(() => {
      const hh = new Date().getHours();
      const p2 = hh >= 5 && hh < 9 ? 'dawn' : hh >= 9 && hh < 17 ? 'day' : hh >= 17 && hh < 21 ? 'dusk' : 'night';
      if (p2 !== document.body.dataset.daypart) document.body.dataset.daypart = p2;
    }, 600000);
  })();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountThemeToggle);
else mountThemeToggle();

// ===== 布局密度切换（紧凑/舒适）=====
function mountDensityToggle() {
  const btn = document.createElement('button');
  btn.id = 'densityToggle';
  btn.title = '布局密度：紧凑/舒适';
  const apply = (dense) => {
    document.documentElement.classList.toggle('dense-mode', dense);
    btn.textContent = dense ? '⇔' : '≡';
    localStorage.setItem('navsite.density', dense ? 'dense' : 'cozy');
  };
  apply(localStorage.getItem('navsite.density') === 'dense');
  btn.onclick = () => apply(!document.documentElement.classList.contains('dense-mode'));
  btn.style.cssText = 'position:fixed;right:20px;bottom:100px;width:38px;height:38px;border-radius:50%;border:1px solid var(--color-line);backdrop-filter:blur(8px);background:color-mix(in srgb, var(--color-card) 80%, transparent);font-size:16px;cursor:pointer;z-index:98;color:var(--color-ink);box-shadow:var(--shadow-pop)';
  document.body.appendChild(btn);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountDensityToggle);
else mountDensityToggle();

// 检查上游健康：返回该上游是否离线（超过 2 小时没成功过）
async function upstreamStatus(name) {
  try {
    const r = await fetch('/api/health/upstream');
    const d = await r.json();
    const e = d.data?.[name];
    if (!e) return 'unknown';
    if (e.ok && d.now - e.lastOkAt < 2 * 3600_000) return 'live';
    return 'stale';
  } catch { return 'unknown'; }
}

// ===== 音效引擎（Web Audio 合成，零音频文件）=====
const SoundFX = (() => {
  let ctx = null;
  let enabled = localStorage.getItem('navsite.sound') !== 'off';
  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur = 0.08, type = 'sine', gain = 0.04, when = 0) {
    if (!enabled) return;
    try {
      const a = ac(), o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, a.currentTime + when);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + when + dur);
      o.connect(g).connect(a.destination);
      o.start(a.currentTime + when); o.stop(a.currentTime + when + dur + 0.02);
    } catch {}
  }
  return {
    click: () => tone(880, 0.05, 'sine', 0.03),
    pop:   () => { tone(520, 0.07, 'triangle', 0.05); tone(780, 0.09, 'triangle', 0.04, 0.05); },
    switch:() => { tone(440, 0.06, 'sine', 0.035); tone(660, 0.08, 'sine', 0.03, 0.06); },
    chime: () => { tone(660, 0.12, 'sine', 0.04); tone(880, 0.15, 'sine', 0.035, 0.1); tone(1320, 0.2, 'sine', 0.03, 0.22); },
    toggle(v) { enabled = v; localStorage.setItem('navsite.sound', v ? 'on' : 'off'); },
    get on() { return enabled; },
  };
})();
window.__navsite?.sound !== undefined || (window.__navsite && (window.__navsite.sound = SoundFX));

// ===== 命令面板（Ctrl+K）=====
const CmdPalette = {
  setup() {
    const open = ref(false);
    const q = ref('');
    const idx = ref(0);
    const links = ref([]);
    const spaces = ref([]);
    const inputEl = ref(null);

    const commands = computed(() => {
      const cmds = [];
      for (const s of spaces.value) cmds.push({ icon: s.icon, label: '切换空间：' + s.name, act: () => window.__navsite.switchSpace(s.id) });
      cmds.push({ icon: '🎨', label: '打开主题编辑器', act: () => window.open('/admin/editor.html') });
      cmds.push({ icon: '⚙️', label: '打开管理后台', act: () => window.open('/admin/admin.html') });
      cmds.push({ icon: '≡', label: '切换布局密度（紧凑/舒适）', act: () => document.getElementById('densityToggle')?.click() });
      cmds.push({ icon: '🌊', label: (window.__navsite?.liveWall?.on ? '关闭' : '开启') + '动态壁纸（省电）', act: () => window.__navsite?.liveWall?.toggle() });
      // 快速添加：add 标题 网址
      const ql = q.value.trim();
      // 彩蛋命令：/matrix /snow /fireworks /clear
      if (/^\/(matrix|snow|fireworks|clear)$/i.test(ql)) {
        const cmd = ql.toLowerCase();
        cmds.push({ icon: '🎆', label: '触发彩蛋 ' + cmd, act: () => window.__navsite.egg(cmd) });
      }
      if (/^add\s+/i.test(ql)) {
        const rest = ql.replace(/^add\s+/i, '');
        const m = rest.match(/^(.*?)(https?:\/\/\S+)\s*$/);
        cmds.push({
          icon: '➕',
          label: m ? `添加链接：「${m[1].trim()}」 ${m[2]}` : '格式：add 标题 https://网址',
          act: async () => {
            if (!m) return;
            try {
              await fetch('/api/admin/links', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category_id: window.__navsite.defaultCatId, title: m[1].trim() || new URL(m[2]).hostname, url: m[2] }),
              });
              window.__navsite.reload();
            } catch { alert('快速添加需要先登录后台（且存在至少一个分类）'); }
          },
        });
      }
      const low = ql.toLowerCase();
      // 全局内容搜索（B 端点）：链接标题 + 待办/速记/句子，debounce 太复杂——命令面板展开时按需查
      if (low.length >= 2) {
        fetch('/api/search?q=' + encodeURIComponent(low)).then(r => r.json()).then(d => {
          const dt = (d.data) || {};
          (dt.links || []).slice(0, 6).forEach(l => cmds.push({ icon: '🔗', label: `${l.title}　${l.category || ''}`, act: () => window.open(l.url, '_blank') }));
          (dt.notes || []).slice(0, 4).forEach(n => cmds.push({ icon: '📝', label: `[${n.widget || '内容'}] ${String(n.text || '').slice(0, 40)}`, act: null }));
        }).catch(() => {});
      }
      const linkHits = links.value.filter(l => !low || l.title.toLowerCase().includes(low) || (l.description || '').toLowerCase().includes(low)).slice(0, 8);
      for (const l of linkHits) cmds.push({ icon: '🔗', label: l.title + '　' + (l.description || ''), act: () => window.open(l.url, '_blank') });
      return cmds;
    });

    async function load() {
      try {
        const [ls, sp] = await Promise.all([api('/api/links?kw='), api('/api/spaces')]);
        links.value = ls; spaces.value = sp;
      } catch {}
    }
    load();

    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open.value = !open.value; if (open.value) setTimeout(() => inputEl.value?.focus(), 50); return; }
      if (!open.value) return;
      if (e.key === 'Escape') { open.value = false; }
      else if (e.key === 'ArrowDown') { idx.value = Math.min(idx.value + 1, commands.value.length - 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx.value = Math.max(idx.value - 1, 0); e.preventDefault(); }
      else if (e.key === 'Enter') { const c = commands.value[idx.value]; if (c) { open.value = false; c.act(); } }
    }
    window.addEventListener('keydown', onKey);

    const fuzzyScore = (label, kw) => {
      const L = label.toLowerCase();
      if (L.includes(kw)) return 1000 - L.indexOf(kw);
      // 子序列匹配：kw 字符依序出现在 label 中即命中，越紧凑分越高
      let li = 0, gaps = 0, first = -1;
      for (const ch of kw) {
        const f = L.indexOf(ch, li);
        if (f < 0) return -1;
        if (first < 0) first = f;
        if (f > li) gaps += f - li;
        li = f + 1;
      }
      return 500 - gaps - first;
    };
    const shownCmds = computed(() => {
      const kw = q.value.trim().toLowerCase();
      const base = commands.value.filter(c => c.icon !== '🔗');
      const linkCmds = commands.value.filter(c => c.icon === '🔗');
      if (!kw) return [...base, ...linkCmds];
      const f = base.map(c => [fuzzyScore(c.label, kw), c]).filter(x => x[0] >= 0)
        .sort((a, b) => b[0] - a[0]).map(x => x[1]);
      return [...f, ...linkCmds];
    });
    return { open, q, idx, commands, shownCmds, inputEl };
  },
  template: `
    <teleport to="body">
      <div class="cmd-overlay" v-if="open" @click.self="open=false">
        <div class="cmd-box">
          <input ref="inputEl" v-model="q" class="cmd-input" placeholder="输入命令、搜索链接…" />
          <div class="cmd-list">
            <div v-for="(c,i) in shownCmds" :key="i" class="cmd-item" :class="{active:i===idx}"
              @mouseenter="idx=i" @click="open=false; c.act()">
              <span class="cmd-icon">{{ c.icon }}</span>{{ c.label }}
            </div>
            <div v-if="!commands.length" class="cmd-item empty">没有匹配的命令</div>
          </div>
          <div class="cmd-hint">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
        </div>
      </div>
    </teleport>
  `,
};

// ===== 根应用 =====
const App = {
  components: { 'cmd-palette': CmdPalette, 'toast-tip': Toast },
  setup() {
    const spaces = ref([]);
    const currentSpace = ref(0);
    const categories = ref([]);
    const loading = ref(true);
    const appearance = ref({});
    const soundOn = ref(SoundFX.on);
    const toggleSound = () => { SoundFX.toggle(!SoundFX.on); soundOn.value = SoundFX.on; if (SoundFX.on) SoundFX.chime(); };
    const widgets = ref([]);
    const theme = ref({});

    const readonly = ref(false); // 分享只读模式
    const spaceDir = ref('none'); // 切换方向：left/right/none
    async function loadSpace(sid) {
      const prev = currentSpace.value;
      if (prev && prev !== sid) {
        const order = spaces.value.map(s => s.id);
        spaceDir.value = order.indexOf(sid) > order.indexOf(prev) ? 'right' : 'left';
      } else spaceDir.value = 'none';
      currentSpace.value = sid;
      const sp = spaces.value.find(s => s.id === sid);
      theme.value = sp ? JSON.parse(sp.theme_json || '{}') : {};
      applyTheme(theme.value);
      // 布局：解析 layout_json 中的 widget 引用
      const layout = sp ? JSON.parse(sp.layout_json || '[]') : [];
      if (layout.length) {
        widgets.value = layout;
      } else {
        // 默认布局兜底
        widgets.value = [
          { type: 'searchbar', props: {} },
          { type: 'clock', props: {} },
          ...categories.value.map(c => ({ type: 'category', props: {}, categoryId: c.id })),
        ];
      }
      if (prev && prev !== sid) bus.emit('space.switch', sid);
    }

    onMounted(async () => {
      try {
        const shareCode = new URLSearchParams(location.search).get('share');
        if (shareCode) {
          readonly.value = true;
          const sd = await api('/api/share/' + encodeURIComponent(shareCode));
          spaces.value = [sd.space];
          categories.value = sd.categories;
          await loadSpace(sd.space.id || 0);
          return;
        }
        const [sp, cats] = await Promise.all([api('/api/spaces'), api('/api/categories')]);
        spaces.value = sp;
        categories.value = cats;
        await loadSpace(sp[0]?.id || 0);
      } catch (e) {
        console.error(e);
      } finally {
        loading.value = false;
      }
      // 全局快捷键：/ 聚焦搜索；数字键 1-9 切空间
      window.addEventListener('keydown', e => {
        if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          document.querySelector('.searchbar input')?.focus();
        }
        if (/^[1-9]$/.test(e.key) && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          const target = spaces.value[Number(e.key) - 1];
          if (target && target.id !== currentSpace.value) loadSpace(target.id);
        }
      });
      // 点击计数上报 + 音效 + 触发联动规则
      bus.on('link.click', link => {
        SoundFX.click();
        fetch(`/api/links/${link.id}/click`, { method: 'POST' }).catch(() => {});
      });
      // 空间切换事件上报
      bus.on('space.switch', (space) => {
        fetch('/api/admin/automation/test', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'space.switch', payload: { spaceId: space } }),
        }).catch(() => {});
      });
      // 命令面板桥接：暴露切换空间
      window.__navsite = Object.assign(window.__navsite || {}, {
        switchSpace: (id) => { SoundFX.switch(); loadSpace(id); },
        reload: () => location.reload(),
        defaultCatId: categories.value[0]?.id,
        egg: (cmd) => handleEasterEgg(cmd),
        focusMode: false,
      });
      window.__navsite.sound = SoundFX;
      // 外观自定义：后台遥控（CSS/文案/搜索引擎）
      try {
        const ap = await fetch('/api/appearance').then(r => r.json());
        const d = ap.data || {};
        if (d.customCss) {
          const s = document.createElement('style');
          s.id = 'appearanceCss';
          s.textContent = d.customCss;
          document.head.appendChild(s);
        }
        if (d.siteName) { document.querySelector('.logo').textContent = d.siteName; document.title = d.siteName; }
        if (d.footerText) document.querySelector('.foot').innerHTML = d.footerText;
        appearance.value = d;
        window.__appearance = d;
        window.dispatchEvent(new Event('appearance-ready'));
      } catch {}

      // SSE：接收联动事件（切空间/主题/widget 开关/通知）
      const es = new EventSource('/api/events/space');
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'switch' && data.spaceId) loadSpace(data.spaceId);
          else if (data.type === 'notify' && data.message) showToast(`🔔 ${data.message}`);
          else if (data.type === 'theme' && data.theme) {
            if (data.tokens) applyTheme(data.tokens);
            document.documentElement.dataset.theme = data.theme;
            showToast(`🎨 主题已切换为 ${data.theme}`);
            const btn = document.getElementById('themeToggle');
            if (btn) btn.textContent = isDarkBg() ? '☀️' : '🌙';
          }
          else if (data.type === 'widgets_changed' && data.hidden) loadSpace(currentSpace.value?.id);
        } catch {}
      };
      // 卡片鼠标高光跟随
      document.addEventListener('mousemove', e => {
        const card = e.target.closest?.('.card');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
      }, { passive: true });
    });

    function resolveWidget(w) {
      const cat = categories.value.find(c => c.id === w.categoryId);
      return { comp: registry[w.type]?.component, props: { widget: w, category: cat } };
    }

    return { spaces, currentSpace, loadSpace, categories, loading, widgets, registry, resolveWidget, soundOn, toggleSound, spaceDir, appearance, readonly };
  },
  template: `
    <div class="app">
      <header class="topbar">
        <div class="logo">{{ readonly ? (spaces[0]?.icon || "👁") + " " + (spaces[0]?.name || "") + " · 分享只读" : "🧭 NavSite" }}</div>
        <nav class="space-tabs" v-if="spaces.length > 1">
          <button v-for="s in spaces" :key="s.id" :class="{active: s.id===currentSpace}" @click="loadSpace(s.id)">
            {{ s.icon }} {{ s.name }}
          </button>
        </nav>
      </header>
      <main class="grid" :class="'space-in-' + spaceDir" :key="currentSpace" v-if="!loading">
        <template v-for="(w, i) in widgets" :key="i">
          <component :is="resolveWidget(w).comp" v-bind="resolveWidget(w).props" v-if="resolveWidget(w).comp && !w.hidden" :style="[[w.w ? 'grid-column: span ' + w.w : '', w.h >= 1 ? 'grid-row: span ' + w.h + '; align-self: stretch;' : ''], w.props?.bg ? 'background-image: linear-gradient(rgba(13,17,26,.45), rgba(13,17,26,.60)), url(' + w.props.bg + '); background-size: cover; background-position: center;' : '', w.props?.css || '']"/>
        </template>
      </main>
      <div class="loading" v-else>加载中…</div>
      <footer class="foot" v-if="!readonly">NavSite · 一切皆可配置 · <kbd>Ctrl+K</kbd> 命令面板 · <kbd>/</kbd> 搜索 · <kbd>1-9</kbd> 切空间 · <a href="javascript:void(0)" class="foot-link" @click="toggleSound">{{ soundOn ? '🔊 音效开' : '🔇 音效关' }}</a></footer>
      <footer class="foot" v-else>👁 只读分享页 · 由 NavSite 生成</footer>
      <cmd-palette />
      <toast-tip />
    </div>
  `,
};

// ===== 全局样式（零 CDN，全部本地）=====
const style = document.createElement('style');
style.textContent = `
:root {
  /* 曜石·玻璃拟态默认主题（现代炫酷） */
  --color-bg: #0b0e14; --color-card: rgba(255,255,255,.055); --color-ink: #e8eaf0;
  --color-muted: #8b93a7; --color-accent: #2dd4bf; --color-line: rgba(255,255,255,.09);
  --radius: 16px; --gap: 16px;
  --glass-blur: saturate(1.4) blur(18px);
  --font-family: 'NavSerif', 'Noto Serif SC', Georgia, serif;
  --glow: 0 0 24px rgba(45,212,191,.12), 0 8px 32px rgba(0,0,0,.45);
}
/* 极光背景：三层彩色光斑缓慢漂移 */
body::before, body::after {
  content: ''; position: fixed; border-radius: 50%; filter: blur(90px);
  pointer-events: none; z-index: 0; opacity: .5;
}
body::before {
  width: 55vw; height: 55vw; left: -12vw; top: -18vw;
  background: radial-gradient(circle, rgba(45,212,191,.20), transparent 65%);
  animation: blob1 26s ease-in-out infinite alternate;
}
body::after {
  width: 48vw; height: 48vw; right: -14vw; bottom: -16vw;
  background: radial-gradient(circle, rgba(124,92,246,.22), transparent 65%);
  animation: blob2 32s ease-in-out infinite alternate;
}
@keyframes blob1 { to { transform: translate(9vw, 7vh) scale(1.15); } }
@keyframes blob2 { to { transform: translate(-8vw, -6vh) scale(1.1); } }
.app, .topbar, header { position: relative; z-index: 1; }
/* 亮色主题（保底切换） */
html[data-theme="亮色"], html:not([data-theme="暗夜"]):not([data-theme="曜石"]) {
  --color-bg: #f7f4ee; --color-card: #fff; --color-ink: #1a2332;
  --color-muted: #6b7280; --color-accent: #0f766e; --color-line: #e2ddd3;
}
html[data-theme="亮色"] body::before, html[data-theme="亮色"] body::after,
html:not([data-theme="曜石"]):not([data-theme="暗夜"]) body::before,
html:not([data-theme="曜石"]):not([data-theme="暗夜"]) body::after { display: none; }
body { background:var(--color-bg) !important; color:var(--color-ink); font-family:var(--font-family); line-height:1.6; }
.app { max-width:1100px; margin:0 auto; padding:24px 20px 80px; }
.topbar { display:flex; align-items:center; gap:20px; padding:8px 0 20px; border-bottom:1px solid var(--color-line); margin-bottom:24px; flex-wrap:wrap; position:relative; }
.topbar::after { content:''; position:absolute; left:0; right:0; bottom:-1px; height:1px; background:linear-gradient(90deg,transparent,rgba(45,212,191,.5) 18%,rgba(124,92,246,.5) 82%,transparent); }
.logo { font-size:22px; font-weight:700; letter-spacing:1px;
  background: linear-gradient(100deg, #2dd4bf, #7c9ef6 55%, #c084fc);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.space-tabs { display:flex; gap:8px; flex-wrap:wrap; }
.space-tabs button { padding:6px 14px; border:1.5px solid var(--color-line); background:var(--color-card); border-radius:99px; cursor:pointer; font-family:inherit; font-size:13px; transition:.15s; }
.space-tabs button.active { border-color:var(--color-accent); background:var(--color-accent); color:#fff; }
.grid { display:grid; grid-template-columns:repeat(12, 1fr); grid-auto-flow:row dense; grid-auto-rows:minmax(90px,auto); gap:var(--gap); align-items:start; }
.widget { min-width:0; min-height:0; overflow:hidden; }
.widget { background:var(--color-card); border:1px solid var(--color-line); border-radius:var(--radius); box-shadow:0 1px 3px rgba(0,0,0,.04); transition:box-shadow .25s ease, transform .25s ease, border-color .25s ease; }
.widget:hover { box-shadow:var(--shadow-card); border-color:color-mix(in srgb, var(--color-accent) 35%, var(--color-line)); }
.clock, .hitokoto { background:transparent; border:none; box-shadow:none; }
.clock:hover, .hitokoto:hover { box-shadow:none; border-color:transparent; }
.searchbar { grid-column: span 12; }
.search-row { display:flex; gap:8px; }
.searchbar input { flex:1; padding:14px 18px; font-size:16px; border:2px solid var(--color-line); border-radius:var(--radius); background:var(--color-card); font-family:inherit; transition:border .15s; }
.searchbar input:focus { outline:none; border-color:var(--color-accent); }
.searchbar .engine { padding:0 10px; border:2px solid var(--color-line); border-radius:var(--radius); background:var(--color-card); font-family:inherit; }
.searchbar button { padding:0 20px; border:none; border-radius:var(--radius); background:var(--color-accent); color:#fff; cursor:pointer; font-family:inherit; }
.results { margin-top:8px; background:var(--color-card); border:1px solid var(--color-line); border-radius:var(--radius); overflow:hidden; box-shadow:var(--shadow-pop); transform-origin: top center; animation: resultsIn .18s cubic-bezier(.2,.8,.3,1) both; }
@keyframes resultsIn { from { opacity:0; transform:translateY(-6px) scale(.98); } to { opacity:1; transform:none; } }
.result { animation: resultIn .22s ease both; }
.result:nth-child(2) { animation-delay:.02s; } .result:nth-child(3) { animation-delay:.04s; }
.result:nth-child(4) { animation-delay:.06s; } .result:nth-child(5) { animation-delay:.08s; }
@keyframes resultIn { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
.result { display:flex; align-items:center; gap:10px; padding:10px 16px; cursor:pointer; border-bottom:1px solid var(--color-line); }
.result:last-child { border-bottom:none; }
.result.active { background:color-mix(in srgb, var(--color-accent) 8%, transparent); }
.ricon { width:18px; height:18px; border-radius:4px; }
.rtitle { font-weight:600; }
.rdesc { color:var(--color-muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.empty { padding:16px; text-align:center; color:var(--color-muted); font-size:14px; }
.clock { grid-column: span 12; text-align:center; padding:12px 0 4px; }
.clock-time { font-size:52px; font-weight:700; letter-spacing:2px; font-variant-numeric:tabular-nums; }
.clock-time .sec { font-size:24px; color:var(--color-muted); }
.clock-date { color:var(--color-muted); font-size:14px; margin-top:2px; }
.clock-greet { color:var(--color-accent); font-size:15px; margin-top:4px; }
.category { grid-column: span 12; }
@media (min-width: 800px) { .category { grid-column: span 6; } }
.category h2 { font-size:16px; padding:8px 0 10px; display:flex; align-items:center; gap:8px; border-bottom:2px solid var(--color-ink); margin-bottom:12px; }
.cicon { font-size:18px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; }
.cards.mode-list { grid-template-columns:1fr; }
.card { display:flex; align-items:center; gap:10px; padding:12px; background:var(--color-card); border:1px solid var(--color-line); border-radius:var(--radius); text-decoration:none; color:inherit; transition:transform .15s, box-shadow .15s, border-color .15s; }
.card:hover { transform:translateY(-2px); box-shadow:var(--shadow-card); border-color:color-mix(in srgb, var(--color-accent) 45%, var(--color-line)); }
.card-icon { width:22px; height:22px; border-radius:5px; flex-shrink:0; }
.card-text { display:flex; flex-direction:column; min-width:0; }
.card-title { font-weight:600; font-size:14px; }
.card-desc { font-size:12px; color:var(--color-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 悬停预览浮层 */
.card { position: relative; }
.card:hover { z-index: 60; }
.card-peek { position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:50; border-radius:10px; overflow:hidden; box-shadow:0 12px 32px rgba(0,0,0,.35); border:1px solid var(--color-line); background:var(--color-card); opacity:0; transform:translateY(-4px); animation:peekIn .18s ease forwards; pointer-events:none; }
@keyframes peekIn { to { opacity:1; transform:translateY(0); } }
.card-peek img { display:block; width:100%; max-height:160px; object-fit:cover; }
.foot { text-align:center; color:var(--color-muted); font-size:12px; margin-top:60px; letter-spacing:.02em; }
.foot kbd { padding:2px 7px; border:1px solid var(--color-line); border-bottom-width:2px; border-radius:5px; font-size:11px; background:var(--color-card); font-family:inherit; margin:0 1px; }
.loading { text-align:center; padding:80px 0; color:var(--color-muted); }
/* 微交互：卡片涟漪 + 错峰入场 */
.card { position:relative; overflow:hidden; }
.card::after { content:''; position:absolute; inset:0; background:radial-gradient(circle at var(--mx,50%) var(--my,50%), color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 60%); opacity:0; transition:opacity .2s; pointer-events:none; }
.card:hover::after { opacity:1; }
.grid .widget { animation:stagger .4s ease both; }
@keyframes stagger { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
/* 空间切换方向动画（:key 重建触发） */
.grid.space-in-right { animation:spinR .45s cubic-bezier(.2,.7,.3,1); }
.grid.space-in-left { animation:spinL .45s cubic-bezier(.2,.7,.3,1); }
@keyframes spinR { from { opacity:0; transform:perspective(1200px) rotateY(-14deg) translateX(40px) scale(.97); } to { opacity:1; transform:perspective(1200px) rotateY(0) translateX(0) scale(1); } }
@keyframes spinL { from { opacity:0; transform:perspective(1200px) rotateY(14deg) translateX(-40px) scale(.97); } to { opacity:1; transform:perspective(1200px) rotateY(0) translateX(0) scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .grid .widget, .grid.space-in-right, .grid.space-in-left { animation: none !important; }
  .card-peek { animation: none !important; opacity: 1 !important; transform: none !important; }
}
/* 一言 */
.hitokoto { grid-column:span 12; text-align:center; padding:14px; cursor:pointer; color:var(--color-muted); font-size:15px; font-style:italic; }
.hitokoto:hover { color:var(--color-accent); }
/* 速记便签 */
.quicknote { grid-column:span 12; }
.minical .cal-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.minical .cal-month { font-weight: 700; letter-spacing: 1px; }
.minical .cal-lunar { font-size: 12px; color: #2dd4bf; }
.minical .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; font-size: 12px; }
.minical .cal-wd { color: rgba(232,234,240,.45); font-size: 11px; }
.minical .cal-cell { padding: 3px 0; border-radius: 6px; color: rgba(232,234,240,.8); }
.minical .cal-cell.empty { visibility: hidden; }
.minical .cal-cell.today { background: linear-gradient(135deg, #14b8a6, #0d9488); color: #04211d; font-weight: 800; box-shadow: 0 0 10px rgba(20,184,166,.45); }
/* 专注模式：隐藏装饰只留核心 */
body.focus-mode .topbar .clock-sub, body.focus-mode .foot, body.focus-mode .hud-overlay, body.focus-mode .focus-btn { opacity: 0; pointer-events: none; }
body.focus-mode .topbar, body.focus-mode .foot { transition: opacity .4s; }
.focus-btn { position: fixed; right: 14px; bottom: 14px; z-index: 60; width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: #8b93a7; font-size: 15px; cursor: pointer; backdrop-filter: blur(10px); transition: all .25s; }
.focus-btn:hover { border-color: rgba(45,212,191,.5); color: #2dd4bf; }
.focus-btn.on { background: rgba(20,184,166,.2); color: #2dd4bf; border-color: rgba(45,212,191,.6); box-shadow: 0 0 12px rgba(20,184,166,.35); }
.note-convert { margin-top: 6px; padding: 4px 14px; border: 1px solid rgba(45,212,191,.35); border-radius: 8px; background: rgba(45,212,191,.08); color: #2dd4bf; font-size: 12px; cursor: pointer; transition: all .2s; }
.note-convert:hover { background: rgba(45,212,191,.18); }
.quicknote { display: flex; flex-direction: column; }
.quicknote textarea { width:100%; min-height:90px; padding:12px; border:1.5px solid var(--color-line); border-radius:var(--radius); background:var(--color-card); color:var(--color-ink); font-family:inherit; font-size:14px; resize:vertical; }
.quicknote textarea:focus { outline:none; border-color:var(--color-accent); }
.note-saved { font-size:11px; color:var(--color-muted); margin-top:4px; min-height:14px; }
/* 习惯打卡 */
.habit { grid-column:span 6; }
.habit-row { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; cursor:pointer; transition:background .2s; user-select:none; }
.habit-row:hover { background:color-mix(in srgb, var(--color-accent) 12%, transparent); }
.habit-check { width:22px; height:22px; border:2px solid var(--color-line); border-radius:50%; display:grid; place-items:center; font-size:13px; color:#fff; flex-shrink:0; transition:all .2s; }
.habit-row.done .habit-check { background:var(--color-accent); border-color:var(--color-accent); }
.habit-name { flex:1; }
.habit-row.done .habit-name { text-decoration:line-through; opacity:.55; }
.habit-streak { font-size:12px; color:var(--color-accent); }
/* 打卡热力图 */
.heatmap { display:flex; gap:3px; margin-top:10px; overflow-x:auto; }
.heat-week { display:flex; flex-direction:column; gap:3px; }
.heat-cell { width:10px; height:10px; border-radius:2px; background:color-mix(in srgb, var(--color-line) 45%, transparent); flex-shrink:0; transition:transform .15s ease; cursor:default; }
.heat-cell:hover { transform:scale(1.4); }
.heat-cell.lv1 { background:color-mix(in srgb, var(--color-accent) 35%, transparent); }
.heat-cell.lv2 { background:color-mix(in srgb, var(--color-accent) 65%, transparent); }
.heat-cell.lv3 { background:var(--color-accent); }
/* RSS 订阅 */
.rss { grid-column: span 6; display: flex; flex-direction: column; gap: 2px; }
.rss-status { font-size: 12px; color: var(--color-muted); padding: 8px; }
.rss-item { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 8px; text-decoration: none; color: inherit; transition: background .15s; }
.rss-item:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
.rss-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.rss-date { font-size: 11px; color: var(--color-muted); flex-shrink: 0; }
/* 天气 */
.weather { grid-column: span 6; display: flex; align-items: center; min-height: 64px; }
.weather-body { display: flex; align-items: center; gap: 14px; width: 100%; }
.weather-icon { font-size: 34px; }
.weather-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.weather-temp { font-size: 22px; font-weight: 700; }
.weather-city { font-size: 11px; color: var(--color-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-desc { font-size: 13px; color: var(--color-muted); max-width: 96px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.weather-status { font-size: 12px; color: var(--color-muted); }
/* 每日一图 */
.dailyshot { grid-column: span 6; }
.shot-wrap { position: relative; border-radius: 12px; overflow: hidden; }
.shot-wrap img { display: block; width: 100%; height: 180px; object-fit: cover; transition: transform .5s ease; }
.shot-wrap:hover img { transform: scale(1.04); }
.shot-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 24px 12px 8px; background: linear-gradient(transparent, rgba(0,0,0,.65)); color: #fff; display: flex; flex-direction: column; }
.shot-title { font-size: 13px; font-weight: 600; }
.shot-copy { font-size: 11px; opacity: .8; }
.shot-status { font-size: 12px; color: var(--color-muted); }
/* 离线数据角标 */
.widget { position: relative; }
.stale-badge { position: absolute; top: 6px; right: 8px; z-index: 5; font-size: 10px; color: var(--color-muted); background: color-mix(in srgb, var(--color-card) 85%, transparent); border: 1px solid var(--color-line); border-radius: 6px; padding: 1px 6px; }
/* toast 轻提示 */
.toast { position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%); z-index: 9999; background: var(--color-card); color: var(--color-ink); border: 1px solid var(--color-line); border-radius: 10px; padding: 9px 18px; font-size: 13px; box-shadow: 0 8px 28px rgba(0,0,0,.3); }
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(10px); }
/* 命令面板 */
.cmd-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:999; display:flex; justify-content:center; align-items:flex-start; padding-top:14vh; backdrop-filter:blur(2px); }
.cmd-overlay { animation: cmdFade .15s ease both; }
@keyframes cmdFade { from { opacity:0; } to { opacity:1; } }
.cmd-box { width:min(560px, 92vw); background:var(--color-card); border:1px solid var(--color-line); border-radius:14px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.3); animation: cmdIn .2s cubic-bezier(.2,.9,.3,1.2) both; }
@keyframes cmdIn { from { opacity:0; transform:translateY(-14px) scale(.96); } to { opacity:1; transform:none; } }
.cmd-input { width:100%; padding:16px 18px; border:none; border-bottom:1px solid var(--color-line); background:transparent; color:var(--color-ink); font-size:16px; font-family:inherit; }
.cmd-input:focus { outline:none; }
.cmd-list { max-height:320px; overflow:auto; }
.cmd-item { padding:11px 18px; cursor:pointer; font-size:14px; display:flex; gap:10px; align-items:center; border-bottom:1px solid var(--color-line); }
.cmd-item:last-child { border-bottom:none; }
.cmd-item.active { background:color-mix(in srgb, var(--color-accent) 10%, transparent); }
.cmd-item.empty { color:var(--color-muted); cursor:default; }
.cmd-icon { width:20px; text-align:center; }
.cmd-hint { padding:8px 18px; font-size:11px; color:var(--color-muted); border-top:1px solid var(--color-line); }
/* 移动端适配 */
@media (max-width: 640px) {
  .app { padding: 14px 12px 60px; }
  .topbar { gap: 10px; padding-bottom: 14px; margin-bottom: 16px; }
  .logo { font-size: 18px; }
  .space-tabs { width: 100%; }
  .space-tabs button { padding: 5px 11px; font-size: 12px; }
  .grid { grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .grid > .widget { grid-column: span 4 !important; }
  .clock-time { font-size: 40px; }
  .clock-time .sec { font-size: 18px; }
  .searchbar input { padding: 12px 14px; font-size: 15px; }
  .cards { grid-template-columns: repeat(auto-fill, minmax(105px, 1fr)); gap: 8px; }
  .card { padding: 10px; }
  .card-desc { display: none; }
  .hitokoto { font-size: 13px; padding: 10px; }
  .widget { padding: 12px 14px !important; }
  .widget .countdown, .widget .recent, .widget .quote { padding: 12px 14px; }
  .cd-days { font-size: 17px; }
  .rss-item { padding: 8px 4px; }
  .rss-title { font-size: 12px; }
  #themeToggle { width: 38px; height: 38px; font-size: 17px; right: 14px; bottom: 58px; }
  .shot-wrap img { height: 150px; }
  .foot { margin-top: 40px; }
  .foot kbd { padding: 1px 5px; font-size: 10px; }
  .cmd-box { width: 94vw; }
  .foot kbd { display: none; }
}
/* 键盘导航焦点环（无障碍） */
:focus-visible { outline:2px solid var(--color-accent); outline-offset:2px; border-radius:4px; }
/* 减少动效偏好 */
@media (prefers-reduced-motion: reduce) { .widget, .card, .heat-cell { transition:none !important; animation:none !important; } }
@media (min-width: 641px) and (max-width: 900px) {
  .grid { grid-template-columns: repeat(8, 1fr); }
}
/* 倒计时 */
.countdown { padding: 14px 18px; }
.cd-head { display: flex; justify-content: space-between; align-items: center; }
.cd-title { font-weight: 600; font-size: 14px; letter-spacing: .02em; }
.cd-add { background: none; border: 1px solid var(--color-line); border-radius: 8px; cursor: pointer; padding: 2px 9px; color: var(--color-muted); font-size: 14px; }
.cd-add:hover { color: var(--color-accent); border-color: var(--color-accent); }
.cd-empty, .rc-empty, .qt-empty { font-size: 12px; color: var(--color-muted); padding: 14px 0 10px; text-align: center; line-height: 1.9; }
.cd-empty::before, .rc-empty::before, .qt-empty::before { display: block; font-size: 30px; opacity: .55; margin-bottom: 4px; }
.cd-empty::before { content: '⏳'; }
.rc-empty::before { content: '👣'; }
.qt-empty::before { content: '✒️'; }
/* 空状态文字轻微呼吸 */
.cd-empty, .rc-empty, .qt-empty { animation: emptyBreath 3.5s ease-in-out infinite; }
@keyframes emptyBreath { 0%,100% { opacity:.75; } 50% { opacity:1; } }
.cd-nearest { display: flex; flex-direction: column; gap: 2px; padding: 10px 0 2px; }
.cd-name { font-size: 15px; font-weight: 600; }
.cd-days { font-size: 20px; font-weight: 700; color: var(--color-accent); }
.cd-days.cd-soon { color: #e05656; animation: cdPulse 1.6s ease infinite; }
@keyframes cdPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
.cd-date { font-size: 11px; color: var(--color-muted); }
.cd-list { list-style: none; padding: 6px 0 0; display: flex; flex-direction: column; gap: 4px; }
.cd-list li { display: flex; justify-content: space-between; font-size: 13px; cursor: pointer; }
.cd-list li:hover .cd-name { text-decoration: line-through; }
/* 最近访问 */
.recent { padding: 14px 18px; }
.rc-head { font-weight: 600; font-size: 14px; margin-bottom: 8px; letter-spacing: .02em; }
.rc-list { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 0; }
.rc-list a { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--color-line); border-radius: 999px; text-decoration: none; color: inherit; font-size: 12px; transition: border-color .2s; }
.rc-list a:hover { border-color: var(--color-accent); }
.rc-icon { width: 14px; height: 14px; border-radius: 3px; }
.rc-title { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 句子收藏 */
.quote { padding: 14px 18px; }
.qt-head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 14px; letter-spacing: .02em; }
.qt-nav { display: flex; gap: 4px; }
.qt-btn { background: none; border: 1px solid var(--color-line); border-radius: 8px; cursor: pointer; padding: 2px 8px; color: var(--color-muted); }
.qt-btn:hover { color: var(--color-accent); border-color: var(--color-accent); }
.qt-body { margin: 10px 0 0; border-left: 3px solid var(--color-accent); padding-left: 12px; cursor: pointer; }
.qt-text { font-size: 14px; line-height: 1.7; font-style: italic; }
.qt-from { font-size: 11px; color: var(--color-muted); }
/* ===== 暗夜模式适配层（data-theme="暗夜" 时自动覆盖）===== */
/* 语义色变量：组件层只写语义变量，暗夜切换只覆盖这里 */
:root { --shadow-card: 0 6px 16px rgba(0,0,0,.08); --shadow-pop: 0 10px 30px rgba(0,0,0,.18); --img-dim: 1; --icon-dim: .92; }
html[data-theme="暗夜"] {
  --shadow-card: 0 6px 18px rgba(0,0,0,.45);
  --shadow-pop: 0 12px 34px rgba(0,0,0,.6);
  --img-dim: .82; --icon-dim: .88;
  color-scheme: dark;
}
/* 卡片阴影/边线统一走变量 */
.card:hover { box-shadow: var(--shadow-card); }
.results, .cmd-box, .card-peek, .toast { box-shadow: var(--shadow-pop); }
/* 每日一图：暗色下调暗 + 降饱和，白字渐变保留可读性 */
html[data-theme="暗夜"] .shot-wrap img { filter: brightness(var(--img-dim)) saturate(.9); }
html[data-theme="暗夜"] .shot-cap { background: linear-gradient(transparent, rgba(0,0,0,.75)); }
/* 天气/每日一图图标与外部图片在暗色下柔和 */
html[data-theme="暗夜"] .widget img { filter: brightness(var(--img-dim)); }
/* 习惯打卡勾选色适配 */
html[data-theme="暗夜"] .habit-check { background: transparent; }
/* 命令面板/弹窗 输入框、option 在暗色下可读 */
html[data-theme="暗夜"] input, html[data-theme="暗夜"] select, html[data-theme="暗夜"] textarea { color-scheme: dark; }
/* 滚动条暗色 */
html[data-theme="暗夜"] ::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,.18); border-radius: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,.3); }
html[data-theme="暗夜"] ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }
html[data-theme="暗夜"] ::-webkit-scrollbar-track { background: transparent; }
/* 暗色下 hover 高光减弱 */
html[data-theme="暗夜"] .card::after { opacity: .12; }
/* 强调色按钮上的白字保持（accent 本身够深/够亮均可读） */
/* 微降动画脉冲在暗色下的刺眼度 */
html[data-theme="暗夜"] .cd-days.cd-soon { color: #f87171; }
/* 浮动主题按钮阴影走变量 */
/* toast 文字色适配 */
html[data-theme="暗夜"] .toast { color: var(--color-ink); }
/* -- todo widget -- */
.todo { min-height: 180px; }
.td-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.td-count { background: var(--color-accent); color: #fff; border-radius: 999px; font-size: 11px; padding: 1px 7px; margin-left: 4px; }
.td-filters button { border: 1px solid var(--color-line); background: transparent; border-radius: 999px; font-size: 11px; padding: 2px 10px; cursor: pointer; color: var(--color-muted); margin-left: 4px; }
.td-filters button.on { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
.td-add input { width: 100%; box-sizing: border-box; border: 1px dashed var(--color-line); border-radius: 8px; padding: 7px 10px; font-size: 13px; background: transparent; color: inherit; }
.td-add input:focus { outline: none; border-color: var(--color-accent); border-style: solid; }
.td-empty { text-align: center; padding: 22px 0 10px; color: var(--color-muted); font-size: 13px; }
.td-list { margin-top: 6px; }
.td-item { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px dashed var(--color-line); animation: tdIn .25s ease; }
@keyframes tdIn { from { opacity: 0; transform: translateY(-4px); } }
.td-item:last-child { border-bottom: none; }
.td-check { width: 18px; height: 18px; border: 1.5px solid var(--color-line); border-radius: 50%; flex-shrink: 0; cursor: pointer; display: grid; place-items: center; font-size: 11px; color: #fff; transition: all .2s; }
.td-item.done .td-check { background: var(--color-accent); border-color: var(--color-accent); box-shadow: 0 0 8px rgba(45,212,191,.4); }
.td-check:hover { border-color: rgba(45,212,191,.7); box-shadow: 0 0 8px rgba(45,212,191,.25); }
.td-star { border: none; background: transparent; color: var(--color-muted); cursor: pointer; font-size: 13px; padding: 2px; transition: all .2s; }
.td-star:hover { color: #fbbf24; transform: scale(1.2); }
.td-text.focus { color: #fbbf24; text-shadow: 0 0 8px rgba(251,191,36,.3); }
.td-text { flex: 1; font-size: 13px; cursor: pointer; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-item.done .td-text { text-decoration: line-through; color: var(--color-muted); }
.td-del { border: none; background: none; color: var(--color-muted); cursor: pointer; opacity: 0; transition: opacity .15s; font-size: 12px; }
.td-item:hover .td-del { opacity: 1; }
.td-del:hover { color: var(--color-danger, #b91c1c); }
.td-clear { border: none; background: none; color: var(--color-muted); font-size: 11px; cursor: pointer; margin-top: 6px; text-decoration: underline; }
.td-enter-active, .td-leave-active { transition: all .25s; }
.td-enter-from, .td-leave-to { opacity: 0; transform: translateX(-10px); }
/* -- pomodoro -- */
.pomodoro { text-align: center; }
.pd-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 10px; }
.pd-rounds { color: var(--color-muted); font-size: 12px; }
.pd-ring { position: relative; width: 130px; height: 130px; margin: 6px auto; cursor: pointer; }
.pd-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.pd-track { fill: none; stroke: var(--color-line); stroke-width: 6; }
.pd-bar { fill: none; stroke: var(--color-accent); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 283; transition: stroke-dashoffset 1s linear, stroke .3s; }
.pd-rest .pd-bar { stroke: #d97706; }
.pd-time { position: absolute; inset: 0; display: grid; place-items: center; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.pd-ops { display: flex; gap: 8px; justify-content: center; margin-top: 8px; }
.pd-ops button { border: 1px solid var(--color-line); background: var(--color-card); border-radius: 8px; padding: 5px 16px; cursor: pointer; font-size: 13px; color: inherit; }
.pd-ops button:hover { border-color: var(--color-accent); color: var(--color-accent); }

/* -- 密度切换 -- */
.dense-mode .grid { gap: 10px; }
.dense-mode .widget { padding: 12px 14px; }
.dense-mode .category .links a { padding: 5px 8px; }
.dense-mode .rss .r-item { padding: 4px 0; }











/* ===== 移动端页脚防撞 ===== */
@media (max-width: 640px) { footer { padding-right: 64px; } }


/* ===== Live 动态壁纸（canvas 流体，零资源程序生成）===== */
#liveWall { position:fixed; inset:0; z-index:-1; opacity:.55; }
#liveWall.off { display:none; }

/* ===== 开机 HUD 启动序列（每次进入 0.9s，sessionStorage 只放一次/会话太严——改每次刷新都放轻量版） ===== */
#bootScreen {
  position: fixed; inset: 0; z-index: 999; background: #0b0e14;
  display: grid; place-items: center; flex-direction: column;
  animation: bootOut .4s ease 0.9s forwards; pointer-events: none;
}
#bootScreen .boot-logo {
  max-width: 86vw; white-space: nowrap; font-size: 30px; font-weight: 800; letter-spacing: .3em; color: #2dd4bf;
  text-shadow: 0 0 24px rgba(45,212,191,.6);
  animation: bootIn .5s ease both;
  font-family: 'NavSerif', serif;
}
#bootScreen .boot-line {
  width: 0; height: 2px; margin-top: 14px; background: linear-gradient(90deg, transparent, #2dd4bf, transparent);
  box-shadow: 0 0 12px rgba(45,212,191,.5);
  animation: bootLine .7s ease .15s both;
}
#bootScreen .boot-sub {
  margin-top: 10px; font-size: 11px; letter-spacing: .4em; color: rgba(139,147,167,.7);
  animation: bootIn .5s ease .35s both;
}
@keyframes bootIn { from { opacity: 0; transform: scale(.92); } }
@keyframes bootLine { from { width: 0; } to { width: 180px; } }
@keyframes bootOut { to { opacity: 0; visibility: hidden; } }
/* ===== 视觉九轮·科技感 HUD ===== */
/* 1. 全屏科技网格（极淡，与壁纸共存） */
.app::before {
  content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    linear-gradient(rgba(45,212,191,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(45,212,191,.045) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 90% 70% at 50% 30%, #000 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 30%, #000 30%, transparent 75%);
}
/* 2. HUD 四角括号（卡片 hover 亮起） */
.widget, .category { position: relative; }
.widget::after, .category::after {
  content: ''; position: absolute; inset: 4px; pointer-events: none; opacity: 0;
  transition: opacity .25s ease;
  background:
    linear-gradient(var(--accent), var(--accent)) top left / 14px 1.5px,
    linear-gradient(var(--accent), var(--accent)) top left / 1.5px 14px,
    linear-gradient(var(--accent), var(--accent)) top right / 14px 1.5px,
    linear-gradient(var(--accent), var(--accent)) top right / 1.5px 14px,
    linear-gradient(var(--accent), var(--accent)) bottom left / 14px 1.5px,
    linear-gradient(var(--accent), var(--accent)) bottom left / 1.5px 14px,
    linear-gradient(var(--accent), var(--accent)) bottom right / 14px 1.5px,
    linear-gradient(var(--accent), var(--accent)) bottom right / 1.5px 14px;
  background-repeat: no-repeat;
  filter: drop-shadow(0 0 6px rgba(45,212,191,.6));
}
.widget:hover::after, .category:hover::after { opacity: .85; }
/* 3. 全息光扫过：hover 时一道斜光掠过卡片 */
.widget { overflow: hidden; }
.widget::before {
  content: ''; position: absolute; top: -60%; left: -80%; width: 45%; height: 220%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.09) 45%, rgba(45,212,191,.12) 55%, transparent);
  transform: rotate(8deg) translateX(-120%);
  transition: transform .8s cubic-bezier(.25,.7,.3,1);
  pointer-events: none; z-index: 2;
}
.widget:hover::before { transform: rotate(8deg) translateX(420%); }
/* 4. 科技标题：字距+微光+前缀刻线 */
.widget h3, .category h2 {
  letter-spacing: .12em !important;
  text-shadow: 0 0 14px rgba(45,212,191,.35);
}
.category h2::before { border-radius: 2px !important; box-shadow: 0 0 8px var(--cat-c1, #0f766e); }
/* 5. 时钟 HUD 化：上下刻度线+系统状态行 */
.clock { position: relative; }
.clock::before, .clock::after {
  content: ''; position: absolute; left: 20%; right: 20%; height: 1px;
  background: repeating-linear-gradient(90deg, rgba(45,212,191,.35) 0 14px, transparent 14px 22px);
}
.clock::before { top: 8px; } .clock::after { bottom: 8px; }
/* 6. 数字仪表感：tabular + 光 */
.clock-time { letter-spacing: .06em !important; }
/* 7. 按钮 HUD：斜切角 */
button, .btn {
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
/* 8. 搜索框扫描线底部 */
.searchbar input {
  border-bottom: 1.5px solid rgba(45,212,191,.4) !important;
}
/* ===== 视觉八轮·本地艺术壁纸 ===== */
/* 每日轮换壁纸（本地生成，零版权）：暗化叠底，玻璃卡浮于其上 */
body::before { opacity: .8; }
body {
  background-image: linear-gradient(rgba(11,14,20,.55), rgba(11,14,20,.68)), var(--wall, none) !important;
  background-size: cover !important;
  background-position: center !important;
  background-attachment: fixed !important;
}
/* 分类卡封面微透出（hover 时浮现） */
.category { background-size: cover; background-position: center; }
/* ===== 视觉七轮·防贴边（图标与卡片边距统一）===== */
.widget, .category, .card { padding-left: 16px !important; padding-right: 16px !important; }
.widget h3, .widget .wtitle, .td-head, .pd-head, .rc-head, .qt-head, .cd-name, .rss-head, .weather-head {
  padding-left: 0 !important; margin-left: 0 !important;
}
/* 天气 emoji 与边距离 */
.weather-now, .weather-main { margin-left: 2px; gap: 10px; }
/* RSS 条目左边距 */
.rss-item { padding-left: 6px !important; padding-right: 6px !important; }
.rss-item:hover { padding-left: 12px !important; }
/* 标题 emoji 与后续文字间距 */
.widget h3:first-child, .wtitle { letter-spacing: .02em; }
/* 待办/番茄标题行不贴顶 */
.td-head, .pd-head { padding-top: 2px; }
/* 倒计时/句子空状态 emoji 与顶部距离 */
.cd-empty, .rc-empty, .qt-empty { padding-top: 26px !important; }
/* 通用：widget 内首个元素不贴顶 */
.widget > *:first-child { margin-top: 2px; }
/* ===== 视觉六轮·Widget 细节精修 ===== */
/* 1. RSS 卡：补头部层级+条目精修 */
.rss-item { padding: 9px 2px !important; border-bottom: 1px solid color-mix(in srgb, var(--color-line) 60%, transparent) !important; transition: background .15s, padding-left .15s; border-radius: 6px; }
.rss-item:hover { background: rgba(45,212,191,.05); padding-left: 8px !important; }
.rss-item:last-child { border-bottom: none !important; }
.rss-title, .rss-item a { font-size: 13.5px; line-height: 1.5; }
.rss-item .fmt-date, .rss-date { color: var(--color-accent); opacity: .75; font-size: 12px; flex: none; }
/* 2. 天气卡：层次重排 */
.weather-now, .weather-main { display: flex; align-items: baseline; gap: 8px; }
.weather-desc { max-width: 110px; }
.weather-emoji, .weather-icon { filter: drop-shadow(0 0 12px rgba(45,212,191,.35)); font-size: 30px !important; }
.weather-meta, .weather-sub { color: var(--color-muted); font-size: 12px; letter-spacing: .03em; }
/* 3. 待办：药丸柔和化+输入框+清除按钮 */
.td-tabs button, .td-filter button {
  background: transparent !important; border: 1px solid transparent !important; color: var(--color-muted) !important;
  border-radius: 999px !important; padding: 3px 12px !important; font-size: 12px !important;
}
.td-tabs button.on, .td-tabs button.active, .td-filter button.on {
  background: rgba(45,212,191,.14) !important; border-color: rgba(45,212,191,.3) !important; color: #5eead4 !important;
}
.td-input, .todo input {
  background: rgba(255,255,255,.04) !important; border: 1px solid var(--color-line) !important;
  border-radius: 8px !important;
}
.td-input:focus, .todo input:focus { border-color: rgba(45,212,191,.4) !important; }
.td-clear, .todo .clear { color: var(--color-muted) !important; font-size: 12px; transition: color .15s; }
.td-clear:hover, .todo .clear:hover { color: #f87171 !important; }
/* 4. 番茄钟：进度环渐变+按钮 */
.pd-ring circle, .pomodoro circle { transition: stroke-dashoffset 1s linear; }
.pd-ring .progress, .pomodoro .progress { stroke: #2dd4bf !important; filter: drop-shadow(0 0 8px rgba(45,212,191,.4)); }
.pd-time, .pomodoro .time { font-variant-numeric: tabular-nums; letter-spacing: .04em; }
/* 5. 空状态微光 */
.cd-empty, .rc-empty, .qt-empty { text-shadow: 0 0 24px rgba(45,212,191,.25); }
/* 6. 最近访问胶囊 */
.rc-item, .recent .chip {
  background: rgba(255,255,255,.05) !important; border: 1px solid var(--color-line) !important;
  border-radius: 999px !important; transition: all .15s;
}
.rc-item:hover, .recent .chip:hover { border-color: rgba(45,212,191,.3) !important; background: rgba(45,212,191,.07) !important; }
/* 7. footer 链接去蓝 */
footer a { color: var(--color-muted) !important; text-decoration: none; border-bottom: 1px dashed var(--color-line); }
footer a:hover { color: var(--color-accent) !important; }
/* 8. widget 内加号按钮统一 */
.widget .add-btn, .widget button.add {
  background: transparent !important; border: 1px solid var(--color-line) !important; color: var(--color-muted) !important;
  border-radius: 50% !important; width: 28px !important; height: 28px !important; line-height: 1 !important;
}
.widget .add-btn:hover, .widget button.add:hover { border-color: var(--accent) !important; color: var(--accent) !important; box-shadow: 0 0 12px rgba(45,212,191,.2) !important; }
/* ===== 视觉五轮·翻牌+视差 ===== */

@keyframes secFlip { 0% { opacity: .2; transform: translateY(-8px) scaleY(.7); } 100% { opacity: 1; transform: none; } }
.clock-time { animation: minPulse 60s ease infinite; }
@keyframes minPulse { 30% { filter: drop-shadow(0 0 34px rgba(45,212,191,.5)) brightness(1.25); } }
.shot-wrap { overflow: hidden; }
.shot-wrap img { will-change: transform; transition: transform .1s linear; }
/* ===== 视觉四轮·玻璃拟态组件化 ===== */
.widget, .category, .card {
  background-color: var(--color-card) !important;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--color-line) !important;
  border-radius: var(--radius);
  box-shadow: var(--glow);
  transition: transform .2s ease, box-shadow .25s ease, border-color .25s ease;
}
.widget:hover, .category:hover, .card:hover {
  transform: translateY(-3px);
  border-color: rgba(45,212,191,.35) !important;
  box-shadow: 0 0 32px rgba(45,212,191,.14), 0 14px 40px rgba(0,0,0,.5);
}
/* 时钟：超大渐变霓虹 */
.clock-time {
  font-size: clamp(56px, 9vw, 92px) !important; font-weight: 800; letter-spacing: .02em;
  color: #f5f7fa;
  text-shadow: 0 0 26px rgba(45,212,191,.28);
}
.clock-time { background: linear-gradient(160deg, #f5f7fa 20%, #2dd4bf 55%, #7c9ef6 85%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.clock-time .sec { display: inline; }
.clock-time .sec {
  -webkit-text-fill-color: #2dd4bf; color: #2dd4bf;
  background: none; -webkit-background-clip: initial; background-clip: initial;
  text-shadow: 0 0 18px rgba(45,212,191,.5);
  animation: secBlink 2s ease-in-out infinite;
}
@keyframes secBlink { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
/* 搜索框玻璃胶囊 */
.searchbar input, .search-input {
  background: rgba(255,255,255,.06) !important; border: 1px solid var(--color-line) !important;
  border-radius: 999px; color: var(--color-ink); backdrop-filter: blur(12px);
  transition: border-color .2s, box-shadow .2s;
}
.searchbar input:focus, .search-input:focus {
  border-color: rgba(45,212,191,.5) !important;
  box-shadow: 0 0 0 4px rgba(45,212,191,.10), 0 0 24px rgba(45,212,191,.12);
}
/* 链接项玻璃胶囊 */
.link-item, .linkitem, .link {
  background: rgba(255,255,255,.04); border: 1px solid transparent;
}
.link-item:hover, .linkitem:hover, .link:hover {
  background: rgba(45,212,191,.08); border-color: rgba(45,212,191,.25);
}
/* 按钮：渐变主按钮 */
.btn, button {
  background: linear-gradient(120deg, #0d9488, #2dd4bf);
  border: none; color: #fff;
}
button.ghost, .btn.ghost { background: transparent; border: 1px solid var(--color-line); color: var(--color-muted); }
button:hover:not(.ghost):not(.btn.ghost) { filter: brightness(1.12); box-shadow: 0 0 18px rgba(45,212,191,.3); }
/* 分类渐变条加霓虹 */
.category::after { height: 3px; box-shadow: 0 0 12px var(--cat-c1, #0f766e); opacity: .9; }
/* 问候语副语 */
.daypart-line { color: var(--color-muted); }
/* 浮钮玻璃化 */
#themeToggle, #densityToggle, .float-btn {
  background: rgba(255,255,255,.07) !important; backdrop-filter: blur(12px);
  border: 1px solid var(--color-line) !important;
}
/* 滚动条 */
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); }
/* footer */
footer { color: var(--color-muted); opacity: .7; }
/* ===== 视觉三轮·去简陋（色彩注入+个性装饰，零资源）===== */
/* A. 分类卡：顶部渐变色条 + 标题色点（6 色循环） */
.category { position: relative; overflow: hidden; }
.category::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, var(--cat-c1, #0f766e), var(--cat-c2, #34d399));
  opacity: .85;
}
.category:nth-of-type(6n+1) { --cat-c1:#0f766e; --cat-c2:#34d399; }
.category:nth-of-type(6n+2) { --cat-c1:#2563eb; --cat-c2:#60a5fa; }
.category:nth-of-type(6n+3) { --cat-c1:#7c3aed; --cat-c2:#c084fc; }
.category:nth-of-type(6n+4) { --cat-c1:#d97706; --cat-c2:#fbbf24; }
.category:nth-of-type(6n+5) { --cat-c1:#e11d48; --cat-c2:#fb7185; }
.category:nth-of-type(6n+6) { --cat-c1:#0891b2; --cat-c2:#67e8f9; }
.category h2 { display:flex; align-items:center; gap:7px; }
.category h2::before {
  content: ''; width: 8px; height: 8px; border-radius: 50%;
  background: linear-gradient(135deg, var(--cat-c1,#0f766e), var(--cat-c2,#34d399));
  flex: none;
}
/* B. 链接项：色底衬+hover 抬升 */
.link-item, .linkitem, .link {
  transition: transform .16s ease, box-shadow .16s ease, background .16s ease;
  border-radius: 8px;
}
.link-item:hover, .linkitem:hover, .link:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(26,35,50,.10);
  background: color-mix(in srgb, var(--color-card) 60%, #fff);
}
/* B2. 链接图标底衬 */
.link-icon, .link img, .favicon {
  border-radius: 6px; padding: 1px;
  background: color-mix(in srgb, var(--color-accent) 7%, transparent);
}
/* C. hero 丰富：问候语时段副语 + 时钟装饰线 */
.clock-greet::before, .clock-greet::after {
  content: ''; width: 34px; height: 1px;
  background: linear-gradient(90deg, transparent, currentColor);
  opacity: .5;
}
.clock-greet::after { background: linear-gradient(90deg, currentColor, transparent); }
.daypart-line {
  font-size: 13px; color: var(--color-muted); letter-spacing: .1em; margin-top: 6px;
  font-style: normal;
}
/* E. widget 头部图标徽章化 */
.widget h3, .rc-head, .qt-head, .td-head, .pd-head, .cd-name {
  display: flex; align-items: center; gap: 7px;
}
.widget h3:first-child, .widget .wtitle {
  font-size: 14px; font-weight: 700; letter-spacing: .02em;
}
/* F. 按钮/加号统一 hover */
.widget button, .widget .add-btn { transition: all .15s ease; }
.widget button:hover { transform: translateY(-1px); }
/* G. footer 更轻盈 */
footer { opacity: .75; }
/* H. 引号卡片（句子收藏）有内容时显示大引号装饰 */
.qt-quote { position: relative; }
.qt-quote::before {
  content: '“'; position: absolute; top: -18px; left: -6px;
  font-size: 64px; color: color-mix(in srgb, var(--color-accent) 18%, transparent);
  font-family: serif; pointer-events: none;
}
/* ===== 排印升级：Noto Serif SC 本地子集（Bold 标题 / Regular 正文）===== */
@font-face {
  font-family: 'NavSerif';
  src: url('/fonts/serif-sc-bold.woff2') format('woff2');
  font-weight: 600 900; font-display: swap;
}
@font-face {
  font-family: 'NavSerif';
  src: url('/fonts/serif-sc-reg.woff2') format('woff2');
  font-weight: 100 500; font-display: swap;
}
body { font-family: 'NavSerif', 'Noto Serif CJK SC', 'Noto Serif SC', serif; }
.logo, .category h2, .clock-time, .cd-name, .rc-head, .qt-head, .td-head span:first-child, .pd-head span:first-child {
  font-weight: 700; letter-spacing: .04em;
}
.clock-time { font-weight: 800; }
.card-title { font-weight: 600; }

/* ===== 开场动画：首屏依次浮入 + logo 呼吸 ===== */
.app { animation: appIn .5s ease both; }
@keyframes appIn { from { opacity: 0; } }
.logo { animation: logoIn .7s cubic-bezier(.2,.8,.3,1.1) both, logoBreath 5s ease-in-out 1.2s infinite; }
@keyframes logoIn { from { opacity: 0; transform: translateY(-10px) scale(.9); } }
@keyframes logoBreath { 0%,100% { opacity: 1; } 50% { opacity: .82; } }
.topbar .space-tabs button { animation: fadeDown .4s ease both; }
.topbar .space-tabs button:nth-child(1) { animation-delay: .15s; }
.topbar .space-tabs button:nth-child(2) { animation-delay: .22s; }
.topbar .space-tabs button:nth-child(3) { animation-delay: .29s; }
.topbar .space-tabs button:nth-child(4) { animation-delay: .36s; }
@keyframes fadeDown { from { opacity: 0; transform: translateY(-6px); } }
.grid .widget:nth-child(1) { animation-delay: .1s; }
.grid .widget:nth-child(2) { animation-delay: .18s; }
.grid .widget:nth-child(3) { animation-delay: .26s; }
.grid .widget:nth-child(4) { animation-delay: .34s; }
.grid .widget:nth-child(5) { animation-delay: .42s; }
.grid .widget:nth-child(6) { animation-delay: .5s; }
.grid .widget:nth-child(7) { animation-delay: .58s; }
.grid .widget:nth-child(n+8) { animation-delay: .66s; }
/* 时钟数字翻入 */
.clock-time { animation: clockIn .6s cubic-bezier(.2,.8,.3,1.1) .15s both; }
@keyframes clockIn { from { opacity: 0; transform: translateY(14px) scale(.94); } }

/* ===== 时段主题：凌晨/清晨/白天/黄昏/深夜 自动换背景基调 ===== */
:root { --dawn: #f5efe4; --dusk: #f3ece1; --night: #16181d; }
/* body[data-daypart="dawn"] { background-color: var(--dawn); } */
/* body[data-daypart="dusk"] { background-color: var(--dusk); } */
/* body[data-daypart="night"]:not([data-theme="暗夜"]) { background-color: #ece7dc; } */
html[data-theme="暗夜"] body[data-daypart="night"] {
  background-color: var(--night);
  background-image:
    radial-gradient(ellipse 90% 55% at 50% -12%, color-mix(in srgb, #4a5a8a 16%, transparent), transparent),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
}
/* 深夜暗夜模式：卡片更沉 */
html[data-theme="暗夜"] body[data-daypart="night"] .widget { background: #1d2026; border-color: #2a2e37; }
html[data-theme="暗夜"] body[data-daypart="night"] .topbar::after { background: linear-gradient(90deg, transparent, rgba(122,140,190,.5) 18%, rgba(122,140,190,.5) 82%, transparent); }
/* ===== 视觉打磨·沉浸感层（全部零资源 CSS）===== */
/* 1. 纸感背景：极淡渐变光晕 + 噪点纹理（SVG data URI） */
body {
  background-image:
    radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--color-accent) 7%, transparent), transparent),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
  background-attachment: fixed;
}
html[data-theme="暗夜"] body {
  background-image:
    radial-gradient(ellipse 90% 55% at 50% -12%, color-mix(in srgb, var(--color-accent) 11%, transparent), transparent),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
}
/* 2. 顶栏分割线：实线→渐变淡出 */
.topbar { border-bottom: none; position: relative; padding-bottom: 22px; }
.topbar::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1.5px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-ink) 55%, transparent) 18%, color-mix(in srgb, var(--color-ink) 55%, transparent) 82%, transparent);
}
/* 3. 时钟区沉浸：问候语渐变色 + 时钟微光 */
.clock-greet {
  background: linear-gradient(120deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 45%, #7c9cd6));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  font-weight: 600;
}
html[data-theme="暗夜"] .clock-time { text-shadow: 0 0 32px color-mix(in srgb, #7c9cd6 22%, transparent); }
/* 4. 卡片顶部高光细线（拟物） */
.widget:not(.clock):not(.hitokoto)::before {
  content: ''; position: absolute; left: 10%; right: 10%; top: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent);
  pointer-events: none; border-radius: 1px;
}
html[data-theme="暗夜"] .widget:not(.clock):not(.hitokoto)::before {
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.12), transparent);
}
/* 5. 空状态卡片点阵纹理 */
.cd-empty, .rc-empty, .qt-empty {
  background-image: radial-gradient(color-mix(in srgb, var(--color-line) 60%, transparent) 1px, transparent 1px);
  background-size: 14px 14px;
  border-radius: 10px; padding: 22px 10px 16px;
}
/* 6. overlay 细滚动条（全浏览器 webkit 部分） */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--color-muted) 35%, transparent); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--color-muted) 60%, transparent); }
/* -- 分类展开/收起 -- */
.cat-more { display: block; margin: 10px auto 0; border: none; background: none; color: var(--color-accent); font-size: 12px; cursor: pointer; font-family: inherit; }
.cat-more:hover { text-decoration: underline; }
/* -- 分类卡内过滤 -- */
.cat-filter { width: 100%; box-sizing: border-box; margin: -2px 0 8px; border: 1px solid var(--color-line); border-radius: 8px; padding: 5px 10px; font-size: 12px; background: transparent; color: inherit; }
.cat-filter:focus { outline: none; border-color: var(--color-accent); }
.cat-nomatch { font-size: 12px; color: var(--color-muted); text-align: center; padding: 8px 0; }
`;
document.head.appendChild(style);

const __app = createApp(App);
__app.config.errorHandler = (err, inst, info) => { document.title = 'ERR: ' + err.message + ' @ ' + info; console.error('[VueErr]', err, info); };
__app.mount('#app');
// 命令面板：teleport 到 body，由主模板内的 <cmd-palette/> 渲染——注册到主 app 即可
// （CmdPalette 已在 App 模板中使用，需把组件传入主 app 的 components）
