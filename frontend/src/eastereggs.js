// 彩蛋系统：/matrix 数字雨、/snow 下雪、/fireworks 烟花
// 由命令面板输入 "/xxx" 触发，全 canvas 实现，零依赖

export function handleEasterEgg(cmd) {
  if (cmd === '/matrix') return easterMatrix();
  if (cmd === '/snow') return easterSnow();
  if (cmd === '/fireworks') return easterFireworks();
  if (cmd === '/clear') { location.reload(); return true; }
  return false;
}

function makeCanvas(zIndex) {
  const c = document.createElement('canvas');
  c.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${zIndex}`;
  document.body.appendChild(c);
  return c;
}

function easterMatrix() {
  const canvas = makeCanvas(9998);
  const ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  resize(); window.addEventListener('resize', resize);
  const chars = 'アイウエオカキクケコサシスセソ01アイウエオ'.split('');
  const fontSize = 16, cols = Math.floor(canvas.width / fontSize);
  const drops = Array(cols).fill(1);
  const timer = setInterval(() => {
    ctx.fillStyle = 'rgba(13, 17, 23, 0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f6';
    ctx.font = fontSize + 'px monospace';
    drops.forEach((y, i) => {
      ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fontSize, y * fontSize);
      if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
  }, 50);
  setTimeout(() => { clearInterval(timer); canvas.remove(); }, 20000); // 20秒后自动消失
  return true;
}

function easterSnow() {
  const canvas = makeCanvas(9998);
  const ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  resize(); window.addEventListener('resize', resize);
  const flakes = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * canvas.height,
    r: Math.random() * 3 + 1, speed: Math.random() * 1 + 0.5, sway: Math.random() * 2,
  }));
  const timer = setInterval(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const f of flakes) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
      f.y += f.speed; f.x += Math.sin(f.y / 30) * f.sway * 0.3;
      if (f.y > canvas.height) { f.y = -5; f.x = Math.random() * canvas.width; }
    }
  }, 33);
  setTimeout(() => { clearInterval(timer); canvas.remove(); }, 30000); // 30秒
  return true;
}

function easterFireworks() {
  const canvas = makeCanvas(9999);
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth; canvas.height = innerHeight;
  const particles = [];
  const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff'];
  function burst(x, y) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 * i) / 60;
      const speed = Math.random() * 4 + 2;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color });
    }
  }
  let bursts = 0;
  const launch = setInterval(() => {
    burst(Math.random() * canvas.width * 0.8 + canvas.width * 0.1, Math.random() * canvas.height * 0.4 + canvas.height * 0.15);
    if (++bursts >= 6) clearInterval(launch);
  }, 500);
  const timer = setInterval(() => {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life -= 0.015;
      if (p.life <= 0) particles.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    if (!particles.length && bursts >= 6) { clearInterval(timer); canvas.remove(); }
  }, 33);
  return true;
}
