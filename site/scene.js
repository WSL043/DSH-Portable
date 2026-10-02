import * as THREE from "./vendor/three.module.js";
const canvas = document.querySelector("#volume-scene");
const hero = document.querySelector("[data-hero]");
const stage = document.querySelector("[data-product-stage]");
const root = document.documentElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
camera.position.set(0, 0, 8);
const loader = new THREE.TextureLoader();
const languageOf = () => (root.lang.startsWith("en") ? "en" : "zh");
const shots = {
  zh: ["dsh-interface-zh.png", "dsh-interface-zh-light.png"],
  en: ["dsh-interface-en.png", "dsh-workspace-0.6.4.png"],
};
const loaded = new Map();
function load(file) {
  if (!loaded.has(file))
    loaded.set(
      file,
      loader.loadAsync(new URL(`./assets/${file}`, import.meta.url).href).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        return t;
      }),
    );
  return loaded.get(file);
}
const loadShots = (language) => Promise.all(shots[language].map(load));
const [[dark, bright], atmosphere] = await Promise.all([
  loadShots(languageOf()),
  load("hero-atmosphere.png"),
]);
const fogTarget = new THREE.WebGLRenderTarget(640, 400, {
  depthBuffer: false,
  stencilBuffer: false,
  type: THREE.HalfFloatType,
});
const fogScene = new THREE.Scene(),
  fogCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fogUniforms = {
  time: { value: 0 },
  light: { value: 0 },
  aspect: { value: 1 },
  shore: { value: 0.255 },
  pointer: { value: new THREE.Vector3(0.5, 0.5, 0) },
  photo: { value: atmosphere },
};
const fogMaterial = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: fogUniforms,
  vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader: `
varying vec2 v;uniform sampler2D photo;uniform float time,light,aspect,shore;uniform vec3 pointer;
float hash(vec3 p){p=fract(p*.3183+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 q=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(q),hash(q+vec3(1,0,0)),f.x),mix(hash(q+vec3(0,1,0)),hash(q+vec3(1,1,0)),f.x),f.y),mix(mix(hash(q+vec3(0,0,1)),hash(q+vec3(1,0,1)),f.x),mix(hash(q+vec3(0,1,1)),hash(q+vec3(1,1,1)),f.x),f.y),f.z);}
float field(vec3 p){return noise(p)*.64+noise(p*2.07)*.28+noise(p*4.1)*.08;}
void main(){
vec2 sampleUV=v;float imageAspect=1.8;if(aspect>imageAspect)sampleUV.y=(v.y-.5)*imageAspect/aspect+.5;else sampleUV.x=(v.x-.5)*aspect/imageAspect+.5;
float original=dot(texture2D(photo,sampleUV).rgb,vec3(.2126,.7152,.0722));
vec3 ro=vec3(0,0,5),rd=normalize(vec3((v-.5)*vec2(aspect,1.),-1.4));
float trans=1.,scatter=0.;
for(int i=0;i<24;i++){
float t=5.+float(i)*.32;vec3 p=ro+rd*t;
vec3 drift=p*vec3(.62,1.15,.48)+vec3(-time*.24,time*.07,time*.045);
float f=field(drift+vec3(field(drift*.8+time*.06)));
float sheet=exp(-pow((p.y+.7+.28*sin(p.x*.7))/1.4,2.));
float density=smoothstep(.35,.68,f)*sheet*.65;
float rayPlane=p.y+.17*p.x+.55;
float beam=exp(-rayPlane*rayPlane/.065)+.4*exp(-pow(rayPlane-.46,2.)/.11);
float lighting=.16+beam*.20;
float alpha=1.-exp(-density*.32);
scatter+=trans*alpha*lighting;trans*=1.-alpha;
}
// One density field: luminous haze on charcoal, ink haze on paper.
float haze=clamp((1.-trans)*.48+scatter*.8,0.,.65);
// The pointer carries a soft lamp: the mist thins around it and catches a little light.
vec2 pd=(v-pointer.xy)*vec2(aspect,1.);
float near=exp(-dot(pd,pd)/.028)*pointer.z;
float halo=exp(-dot(pd,pd)/.16)*pointer.z;
haze*=1.-near*.65;
// Mist banks lift off the water and thin out toward the top; a faint glow sits on the horizon.
float rise=smoothstep(1.,shore,v.y)*.55+.45;
float shoreGlow=exp(-pow((v.y-shore-.06)/.115,2.))*(.7+.3*noise(vec3(v.x*3.2-time*.05,v.y*5.,time*.04)));
vec2 off=(v-.5)*vec2(aspect*.62,1.);
float vignette=smoothstep(.2,.95,dot(off,off)*1.7);
float night=original*.12+haze*.105*rise+shoreGlow*.05+halo*.06+near*.035;
night*=1.-vignette*.55;
float day=.965-original*.20-haze*.78*rise-shoreGlow*.05+halo*.03;
day=mix(day,.985,vignette*.45);
float value=mix(night,day,light);
gl_FragColor=vec4(vec3(value),1.);
}`,
});
fogScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fogMaterial));
scene.background = fogTarget.texture;
// Screen-space water reflection keeps the local prototype to one additional scene pass.
const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const waterScene = new THREE.Scene();
const waterUniforms = {
  image: { value: sceneTarget.texture },
  time: { value: 0 },
  light: { value: 0 },
  shore: { value: 0.255 },
  aspect: { value: 1 },
  ripples: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) },
};
waterScene.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: waterUniforms,
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader: `varying vec2 v;uniform sampler2D image;uniform float time,light,shore,aspect;uniform vec4 ripples[6];
 void main(){
 vec3 color=texture2D(image,v).rgb;

 if(v.y<shore){
  float depth=(shore-v.y)/shore;
  float wave=sin(v.y*210.+sin(v.x*14.+time*.38)*1.8-time*.9);
  float fine=sin(v.y*470.+v.x*24.+time*.65);
  vec2 reflected=vec2(v.x+(wave+fine*.35)*.003*depth,shore+(shore-v.y)*.86+wave*.0015*depth);
  // Rings spread from where the pointer touched the water; flattened, as a surface seen at a low angle.
  vec2 push=vec2(0.);float ring=0.;
  for(int i=0;i<6;i++){
   vec4 r=ripples[i];float age=time-r.z;
   if(r.w>0.&&age>0.&&age<4.5){
    vec2 d=(v-r.xy)*vec2(aspect,3.2);float dist=length(d);float front=age*.24;
    float band=exp(-pow((dist-front)/.05,2.))*exp(-age*.95)*r.w;
    float w=sin((dist-front)*95.)*band;
    push+=d/(dist+.0001)*w*.011;ring+=w;
   }
  }
  reflected+=push;
  float spread=.004+depth*.018;
  vec3 reflection=(texture2D(image,reflected).rgb*2.+texture2D(image,reflected+vec2(spread,0.)).rgb+texture2D(image,reflected-vec2(spread,0.)).rgb)*.25;
  vec3 water=vec3(mix(.007,.79,light));
  float strength=.56*pow(1.-depth,1.35);
  vec3 surface=mix(water,reflection,strength);
  float glint=pow(max(0.,wave*.65+fine*.35),12.)*.016*depth;
  float drift=pow(max(0.,sin(v.x*38.+sin(v.y*90.+time*.5)*2.4-time*.32)),18.)*.011*(1.-depth)*(1.-depth);
  surface+=vec3(glint+drift)*mix(1.,.4,light);
  surface+=vec3(max(ring,0.)*mix(.07,-.06,light));
  float horizon=exp(-pow((v.y-shore)/.0014,2.));
  surface+=vec3(horizon*mix(.14,-.07,light));
  color=mix(color,surface,smoothstep(0.,.035,shore-v.y));
 }
 gl_FragColor=vec4(color,1.);
 #include <colorspace_fragment>
 }`,
    }),
  ),
);
function rounded(w, h, r) {
  const x = -w / 2,
    y = -h / 2,
    s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const w = 4.1,
  h = 2.61,
  panel = new THREE.Group();
const faceUniforms = {
  dark: { value: dark },
  bright: { value: bright },
  nextDark: { value: dark },
  nextBright: { value: bright },
  swap: { value: 0 },
  light: { value: 0 },
};
const face = new THREE.Mesh(
  new THREE.ShapeGeometry(rounded(w - 0.006, h - 0.006, 0.061), 20),
  new THREE.ShaderMaterial({
    uniforms: faceUniforms,
    vertexShader: `varying vec2 v;void main(){v=position.xy/vec2(${w},${h})+.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    // The language switch crossfades to the other screenshot pair, the same way the theme fades.
    fragmentShader: `varying vec2 v;uniform sampler2D dark,bright,nextDark,nextBright;uniform float light,swap;
void main(){
float focus=sin(swap*3.14159)*3.2;
vec4 now=mix(texture2D(dark,v,focus),texture2D(bright,v,focus),light);
vec4 next=mix(texture2D(nextDark,v,focus),texture2D(nextBright,v,focus),light);
gl_FragColor=mix(now,next,swap);
#include <colorspace_fragment>
}`,
  }),
);
face.position.z = 0.071;
panel.add(face);
scene.add(panel);

let desired = root.dataset.theme === "light" ? 1 : 0,
  level = desired;
let paused = root.dataset.motion !== "full",
  clock = 0,
  last = 0,
  frame = 0,
  visible = true,
  lost = false;
let from = level,
  transitionStart = 0,
  transitioning = false;
let shown = languageOf(),
  swapStart = 0,
  swapping = false;
function finishSwap() {
  faceUniforms.dark.value = faceUniforms.nextDark.value;
  faceUniforms.bright.value = faceUniforms.nextBright.value;
  faceUniforms.swap.value = 0;
  swapping = false;
}
new MutationObserver(async () => {
  const language = languageOf();
  if (language === shown) return;
  shown = language;
  const [nextDark, nextBright] = await loadShots(language);
  if (language !== shown) return;
  if (swapping) finishSwap();
  faceUniforms.nextDark.value = nextDark;
  faceUniforms.nextBright.value = nextBright;
  swapStart = performance.now();
  swapping = true;
  wake();
}).observe(root, { attributes: true, attributeFilter: ["lang"] });
// Warm the other language's screenshots before the switch is clicked.
document
  .querySelector("[data-language-switch]")
  ?.addEventListener("pointerenter", () => loadShots(languageOf() === "en" ? "zh" : "en"), { once: true });
let targetX = 0,
  targetY = 0,
  tiltX = 0,
  tiltY = 0;
const stateObserver = new MutationObserver(() => {
  const next = root.dataset.theme === "light" ? 1 : 0;
  paused = root.dataset.motion !== "full";
  if (next !== desired) {
    from = level;
    desired = next;
    transitionStart = performance.now();
    transitioning = true;
  }
  if (paused) {
    targetX = targetY = tiltX = tiltY = 0;
  }
  wake();
});
stateObserver.observe(root, {
  attributes: true,
  attributeFilter: ["data-theme", "data-motion"],
});
stage.addEventListener(
  "pointermove",
  (event) => {
    if (paused || event.pointerType === "touch") return;
    const rect = stage.getBoundingClientRect();
    targetY = ((event.clientX - rect.left) / rect.width - 0.5) * 0.17;
    targetX = ((event.clientY - rect.top) / rect.height - 0.5) * 0.1;
    wake();
  },
  { passive: true },
);
stage.addEventListener("pointerleave", () => {
  targetX = targetY = 0;
  wake();
});
// Lamp and ripples follow the pointer anywhere in the hero (not on touch, not with reduced motion).
const lamp = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, target: 0, idle: 0 };
let rippleIndex = 0,
  lastRipple = { x: -1, y: -1, t: 0 };
function addRipple(x, y, strength) {
  const slot = waterUniforms.ripples.value[rippleIndex++ % 6];
  slot.set(x, y, clock, strength);
}
function heroPoint(event) {
  const rect = hero.getBoundingClientRect();
  return [(event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height];
}
hero.addEventListener(
  "pointermove",
  (event) => {
    if (paused || event.pointerType === "touch") return;
    const [x, y] = heroPoint(event);
    lamp.tx = x;
    lamp.ty = y;
    lamp.target = 1;
    lamp.idle = performance.now();
    const shore = waterUniforms.shore.value;
    const moved = Math.hypot((x - lastRipple.x) * 1.6, y - lastRipple.y);
    if (y < shore - 0.01 && moved > 0.05 && clock - lastRipple.t > 0.16) {
      addRipple(x, y, 0.55);
      lastRipple = { x, y, t: clock };
    }
    wake();
  },
  { passive: true },
);
hero.addEventListener("pointerleave", () => {
  lamp.target = 0;
  wake();
});
hero.addEventListener("pointerdown", (event) => {
  if (paused || event.target.closest("a, button")) return;
  const [x, y] = heroPoint(event);
  if (y < waterUniforms.shore.value - 0.005) {
    addRipple(x, y, 1.4);
    wake();
  }
});
let baseY = 0,
  sinkDepth = 0;
addEventListener("scroll", () => !paused && wake(), { passive: true });
const mobile_shore = (width) => (width <= 760 ? 0.205 : 0.255);
function size() {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  sceneTarget.setSize(
    Math.round(width * renderer.getPixelRatio()),
    Math.round(height * renderer.getPixelRatio()),
  );
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const fogWidth = Math.min(width, 800);
  fogTarget.setSize(
    Math.round(fogWidth),
    Math.round((fogWidth * height) / width),
  );
  fogUniforms.aspect.value = width / height;
  waterUniforms.aspect.value = width / height;
  fogUniforms.shore.value = mobile_shore(width);
  const mobile = width <= 760;
  const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 8;
  const viewWidth = viewHeight * camera.aspect;
  const panelScale = (viewWidth * (mobile ? 0.86 : 0.52)) / w;
  const shoreline = mobile ? 0.205 : 0.255;
  panel.scale.setScalar(panelScale);
  baseY = viewHeight * (shoreline - 0.5 + 0.015) + h * panelScale / 2;
  sinkDepth = h * panelScale * 0.55;
  panel.position.set(mobile ? 0 : viewWidth * 0.175, baseY, 0);
  waterUniforms.shore.value = shoreline;
  wake();
}
function render(now) {
  frame = 0;
  if (document.hidden || !visible || lost) return;
  const dt = Math.max(0, (now - last) / 1000);
  last = now;
  if (!paused) clock += dt;
  if (transitioning) {
    const t = paused ? 1 : Math.min(1, (now - transitionStart) / 2200);
    const ease = t * t * (3 - 2 * t);
    level = from + (desired - from) * ease;
    if (t === 1) transitioning = false;
  }
  if (swapping) {
    const t = paused ? 1 : Math.min(1, (now - swapStart) / 1300);
    faceUniforms.swap.value = t * t * (3 - 2 * t);
    if (t === 1) finishSwap();
  }
  tiltX = THREE.MathUtils.damp(tiltX, targetX, 7, dt);
  tiltY = THREE.MathUtils.damp(tiltY, targetY, 7, dt);
  if (Math.abs(tiltX - targetX) < 0.0001) tiltX = targetX;
  if (Math.abs(tiltY - targetY) < 0.0001) tiltY = targetY;
  fogUniforms.time.value = clock;
  fogUniforms.light.value = level;
  faceUniforms.light.value = level;
  // Scrolling away tips the window back and lets it settle toward the water.
  const out = paused ? 0 : Math.min(1, Math.max(0, scrollY / Math.max(1, hero.offsetHeight)));
  const ease = out * out * (3 - 2 * out);
  panel.rotation.set(0.012 + tiltX - ease * 0.42, -0.07 + tiltY, 0);
  panel.position.y = baseY - ease * sinkDepth;
  if (!paused && performance.now() - lamp.idle > 2600) lamp.target = 0;
  if (paused) lamp.target = lamp.on = 0;
  lamp.x = THREE.MathUtils.damp(lamp.x, lamp.tx, 5, dt);
  lamp.y = THREE.MathUtils.damp(lamp.y, lamp.ty, 5, dt);
  lamp.on = THREE.MathUtils.damp(lamp.on, lamp.target, 2.4, dt);
  if (lamp.on < 0.001 && lamp.target === 0) lamp.on = 0;
  fogUniforms.pointer.value.set(lamp.x, lamp.y, lamp.on);
  renderer.setRenderTarget(fogTarget);
  renderer.render(fogScene, fogCamera);
  // Reflect this frame, including the current tilt, rather than a separate image.
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);
  waterUniforms.time.value = clock;
  waterUniforms.light.value = level;
  renderer.setRenderTarget(null);
  renderer.render(waterScene, fogCamera);
  hero.classList.add("scene-ready");
  if (!paused || transitioning || swapping || tiltX !== targetX || tiltY !== targetY)
    frame = requestAnimationFrame(render);
}
function stop() {
  canvas.dataset.rendering = "paused";
  cancelAnimationFrame(frame);
  frame = 0;
}
function wake() {
  if (!frame && !document.hidden && visible && !lost) {
    canvas.dataset.rendering = "active";
    last = performance.now();
    frame = requestAnimationFrame(render);
  }
}
new ResizeObserver(size).observe(canvas);
new IntersectionObserver((entries) => {
  visible = entries[0].isIntersecting;
  if (visible) wake();
  else stop();
}).observe(hero);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else wake();
});
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  lost = true;
  stop();
  hero.classList.remove("scene-ready");
});
canvas.addEventListener("webglcontextrestored", () => {
  lost = false;
  wake();
});
size();
