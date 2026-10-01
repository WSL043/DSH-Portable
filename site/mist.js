import * as THREE from "./vendor/three.module.js";
// Low-resolution drifting mist, fixed behind the page below the hero. Cheap by design: one 2D fbm pass at ~480px wide.
const root = document.documentElement;
const hero = document.querySelector("[data-hero]");
const canvas = document.createElement("canvas");
canvas.id = "page-mist";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const uniforms = { time: { value: 0 }, light: { value: 0 }, aspect: { value: 1 }, scroll: { value: 0 } };
scene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms,
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `varying vec2 v;uniform float time,light,aspect,scroll;
float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
 vec2 p=vec2(v.x*aspect*.9,v.y*1.6)+vec2(time*.011,-scroll*.5);
 float w=fbm(p+vec2(fbm(p*1.3+time*.019),fbm(p*1.3-time*.015)));
 float bank=smoothstep(.44,.8,w);
 float rise=.35+.65*(1.-v.y);
 float glow=exp(-pow((v.y-.04)/.2,2.))*(.6+.4*fbm(vec2(v.x*aspect*2.4-time*.03,time*.02)));
 float a=bank*rise*mix(.17,.11,light)+glow*mix(.07,.05,light);
 vec3 tone=mix(vec3(.82,.86,.92),vec3(.1,.1,.12),light);
 gl_FragColor=vec4(tone*a,a);
}`,
    }),
  ),
);
let level = root.dataset.theme === "light" ? 1 : 0;
let clock = 0, last = 0, frame = 0, on = false, scrollY = 0, shown = 0;
const reduced = () => root.dataset.motion !== "full";
function resize() {
  const width = 480;
  const height = Math.max(120, Math.round((width * innerHeight) / innerWidth));
  renderer.setSize(width, height, false);
  uniforms.aspect.value = innerWidth / innerHeight;
  draw(performance.now(), true);
}
function heroCovers() {
  return hero.getBoundingClientRect().bottom > innerHeight * 0.98;
}
function draw(now, force) {
  frame = 0;
  if (document.hidden) return;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const target = root.dataset.theme === "light" ? 1 : 0;
  level += (target - level) * Math.min(1, dt * 2.4);
  if (Math.abs(level - target) < 0.002) level = target;
  if (!reduced()) clock += dt;
  shown += (scrollY - shown) * Math.min(1, dt * 3.2 + (force ? 1 : 0));
  const covered = heroCovers();
  if (covered && !force) {
    canvas.classList.remove("is-on");
  } else {
    canvas.classList.add("is-on");
    uniforms.time.value = clock;
    uniforms.light.value = level;
    uniforms.scroll.value = shown / Math.max(1, innerHeight);
    renderer.render(scene, camera);
  }
  if (!reduced() || Math.abs(scrollY - shown) > 0.5 || level !== target) frame = requestAnimationFrame(draw);
}
function wake() {
  if (!frame && !document.hidden) {
    last = performance.now();
    frame = requestAnimationFrame(draw);
  }
}
addEventListener("scroll", () => { scrollY = window.scrollY; wake(); }, { passive: true });
addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); });
new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });
canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); cancelAnimationFrame(frame); frame = 0; canvas.classList.remove("is-on"); });
canvas.addEventListener("webglcontextrestored", wake);
scrollY = window.scrollY;
resize();
wake();
