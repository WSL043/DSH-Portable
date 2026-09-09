const control = document.querySelector('[data-guide-theme]');
const system = matchMedia('(prefers-color-scheme: light)');
let mode = 'system';
try { mode = localStorage.getItem('dsh-portable-theme') || 'system'; } catch {}
function apply() {
  const light = mode === 'light' || (mode === 'system' && system.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  control.textContent = light ? '切换暗色' : '切换亮色';
  control.setAttribute('aria-pressed',String(light));
}
control.addEventListener('click',()=>{
  mode = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try {localStorage.setItem('dsh-portable-theme',mode);} catch {}
  apply();
});
system.addEventListener('change',()=>{if(mode==='system')apply();});
apply();
