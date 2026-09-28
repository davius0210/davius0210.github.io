// Davius 3D layer — background scene, hero voxel island, 3D card tilt & scroll reveal.
// Berdiri sendiri: tidak menyentuh logika Firebase di index-app.js, hanya menghias DOM yang dirender.
import * as THREE from 'three';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const isSmall = () => innerWidth < 768;

const hasWebGL = (() => {
    try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
        return false;
    }
})();

document.documentElement.classList.add('has-3d');
if (reduceMotion) document.documentElement.classList.add('reduce-3d');

// Pointer global dalam rentang -1..1
const pointer = { x: 0, y: 0 };
addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
    requestFrame();
}, { passive: true });

/* ------------------------------------------------------------------ */
/* Render loop bersama                                                 */
/* ------------------------------------------------------------------ */
const views = new Set();
let rafId = 0;
let lastMs = 0;

function requestFrame() {
    if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame);
}

function frame(ms) {
    rafId = 0;
    const dt = lastMs ? Math.min((ms - lastMs) / 1000, 0.05) : 0.016;
    lastMs = ms;
    let again = false;
    for (const v of views) again = v.update(ms / 1000, dt) || again;
    if (again) requestFrame();
    else lastMs = 0;
}

document.addEventListener('visibilitychange', () => {
    lastMs = 0;
    requestFrame();
});
addEventListener('scroll', requestFrame, { passive: true });

/* ------------------------------------------------------------------ */
/* Tekstur blok (assets/blocks)                                        */
/* ------------------------------------------------------------------ */
const texLoader = new THREE.TextureLoader();
const texCache = new Map();

function blockTex(name) {
    if (texCache.has(name)) return texCache.get(name);
    const t = texLoader.load(`assets/blocks/${name}.png`, requestFrame);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    texCache.set(name, t);
    return t;
}

const matCache = new Map();
function blockMat(name, opts = {}) {
    const key = name + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ map: blockTex(name), ...opts }));
    return matCache.get(key);
}

function makeRenderer(canvas) {
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
}

/* ------------------------------------------------------------------ */
/* 1. Background: bentuk low-poly kertas + blok melayang, parallax     */
/* ------------------------------------------------------------------ */
function initBackground() {
    const canvas = document.createElement('canvas');
    canvas.id = 'bg3d';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x7fb4c9, 22, 60);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 18);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3d8f96, 1.6));
    const sun = new THREE.DirectionalLight(0xfff6e0, 2.2);
    sun.position.set(6, 10, 8);
    scene.add(sun);

    const palette = [0x5488c0, 0x4ade80, 0xf4f1ea, 0xcfe0f1, 0xffffff, 0xfbbf24, 0x3f6da3, 0x86efac];
    const geos = [
        new THREE.IcosahedronGeometry(1, 0),
        new THREE.OctahedronGeometry(1, 0),
        new THREE.TetrahedronGeometry(1.15, 0),
        new THREE.DodecahedronGeometry(0.95, 0),
        new THREE.TorusGeometry(0.8, 0.32, 5, 7),
        new THREE.ConeGeometry(0.9, 1.6, 5),
    ];
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.22 });
    const blockNames = ['diamond_block', 'gold_block', 'emerald_block', 'glazed_terracotta_light_blue', 'planks_oak', 'lapis_block', 'packed-ice', 'bookshelf'];
    const cube = new THREE.BoxGeometry(1.4, 1.4, 1.4);

    const RANGE_Y = 44;
    const items = [];
    const count = isSmall() ? 14 : 26;
    const rand = (a, b) => a + Math.random() * (b - a);

    for (let i = 0; i < count; i++) {
        let mesh;
        if (i % 4 === 3) {
            mesh = new THREE.Mesh(cube, blockMat(blockNames[(i >> 2) % blockNames.length]));
        } else {
            const geo = geos[i % geos.length];
            mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                color: palette[i % palette.length],
                flatShading: true,
                roughness: 0.6,
                metalness: 0.05,
            }));
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
        }
        const s = rand(0.55, 1.35);
        mesh.scale.setScalar(s);
        const item = {
            mesh,
            x: rand(-1, 1) < 0 ? rand(-24, -6) : rand(6, 24),
            y: rand(-RANGE_Y / 2, RANGE_Y / 2),
            z: rand(-24, 3),
            spin: new THREE.Vector3(rand(-0.4, 0.4), rand(-0.5, 0.5), rand(-0.2, 0.2)),
            bob: rand(0, Math.PI * 2),
            depth: 0,
        };
        // Objek dekat (z besar) ikut scroll lebih cepat → parallax berlapis
        item.depth = 0.6 + (item.z + 24) / 27;
        mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
        scene.add(mesh);
        items.push(item);
    }

    const cam = { x: 0, y: 0 };

    function resize() {
        renderer.setSize(innerWidth, innerHeight, false);
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        requestFrame();
    }
    addEventListener('resize', resize);
    resize();

    views.add({
        update(t, dt) {
            const motion = reduceMotion ? 0 : 1;
            const scroll = scrollY * 0.012;

            for (const it of items) {
                let y = it.y + scroll * it.depth + Math.sin(t * 0.6 + it.bob) * 0.5 * motion;
                y = ((y + RANGE_Y / 2) % RANGE_Y + RANGE_Y) % RANGE_Y - RANGE_Y / 2;
                it.mesh.position.set(it.x + Math.cos(t * 0.3 + it.bob) * 0.4 * motion, y, it.z);
                it.mesh.rotation.x += it.spin.x * dt * motion;
                it.mesh.rotation.y += it.spin.y * dt * motion;
                it.mesh.rotation.z += it.spin.z * dt * motion;
            }

            const k = reduceMotion ? 1 : 1 - Math.pow(0.001, dt);
            cam.x += (pointer.x * 2.2 - cam.x) * k;
            cam.y += (-pointer.y * 1.4 - cam.y) * k;
            camera.position.x = cam.x;
            camera.position.y = cam.y;
            camera.lookAt(0, 0, -8);
            renderer.render(scene, camera);

            return !reduceMotion || Math.abs(pointer.x * 2.2 - cam.x) > 0.01;
        },
    });
}

/* ------------------------------------------------------------------ */
/* 2. Hero: pulau voxel melayang yang bisa diputar                     */
/* ------------------------------------------------------------------ */
function buildIsland() {
    const island = new THREE.Group();
    const box = new THREE.BoxGeometry(1, 1, 1);

    const grass = [blockMat('grass_side'), blockMat('grass_side'), blockMat('grass'), blockMat('dirt'), blockMat('grass_side'), blockMat('grass_side')];
    const dirt = blockMat('dirt');
    const stone = blockMat('cobblestone');
    const sand = blockMat('sand');
    const logSide = blockMat('log_oak');
    const logTop = blockMat('log_oak_top');
    const log = [logSide, logSide, logTop, logTop, logSide, logSide];
    const leaves = blockMat('leaves_oak', { color: 0x6fbf45, alphaTest: 0.35, side: THREE.DoubleSide });
    const ctSide = blockMat('crafting_table_side');
    const craft = [blockMat('crafting_table_front'), ctSide, blockMat('crafting_table_top'), blockMat('planks_oak'), ctSide, ctSide];

    const waterTex = blockTex('water_still').clone();
    waterTex.repeat.set(1, 1 / 64);
    waterTex.offset.y = 1 - 1 / 64;
    const water = new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.85 });

    const put = (mat, x, y, z, sy = 1) => {
        const m = new THREE.Mesh(box, mat);
        m.position.set(x, y - (1 - sy) / 2, z);
        m.scale.y = sy;
        island.add(m);
        return m;
    };

    const raised = new Set(['-2,-1', '-2,0', '-1,-2', '0,-2', '-1,-1']);
    const sandSpots = new Set(['2,1', '1,2', '2,0']);
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            if (Math.abs(x) === 2 && Math.abs(z) === 2) continue;
            const key = `${x},${z}`;
            if (key === '1,1') {
                put(water, x, 0, z, 0.85);
            } else if (sandSpots.has(key)) {
                put(sand, x, 0, z);
            } else {
                put(grass, x, 0, z);
            }
            if (raised.has(key)) put(grass, x, 1, z);
            put(dirt, x, -1, z);
        }
    }
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) put(Math.abs(x) + Math.abs(z) === 2 ? dirt : stone, x, -2, z);
    [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([x, z]) => put(stone, x, -3, z));
    put(stone, 0, -4, 0);

    // Pohon
    const tx = 1, tz = -1;
    for (let y = 1; y <= 3; y++) put(log, tx, y, tz);
    for (let y = 3; y <= 4; y++) {
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                if (y === 3 && x === 0 && z === 0) continue;
                if (y === 4 && Math.abs(x) === 1 && Math.abs(z) === 1) continue;
                put(leaves, tx + x, y, tz + z);
            }
        }
    }
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, z]) => put(leaves, tx + x, 5, tz + z));

    put(craft, 0, 1, 1).rotation.y = Math.PI / 2;

    // Blok berlian mengorbit pulau
    const gem = new THREE.Mesh(box, blockMat('diamond_block'));
    gem.scale.setScalar(0.6);

    // Bayangan lembut di bawah pulau
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const g = sc.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(20,50,80,0.35)');
    grd.addColorStop(1, 'rgba(20,50,80,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -5.2;

    // Awan kertas
    const clouds = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    [[-5.5, 4.2, -4, 1.1], [3.5, 5.6, -5.5, 0.9], [-6.5, -2.2, 0.5, 0.8]].forEach(([x, y, z, s]) => {
        const c = new THREE.Group();
        const a = new THREE.Mesh(box, cloudMat); a.scale.set(2.4 * s, 0.5 * s, 1.2 * s);
        const b = new THREE.Mesh(box, cloudMat); b.scale.set(1.2 * s, 0.5 * s, 0.9 * s); b.position.set(0.3 * s, 0.4 * s, 0);
        c.add(a, b);
        c.position.set(x, y, z);
        clouds.add(c);
    });

    return { island, gem, shadow, clouds, waterTex };
}

function initHero() {
    const content = document.getElementById('content-area');
    if (!content) return;

    const wrap = document.createElement('div');
    wrap.className = 'hero-3d';
    wrap.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    const hint = document.createElement('span');
    hint.className = 'hero-3d-hint';
    hint.textContent = 'drag to spin';
    wrap.append(canvas, hint);

    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const camBase = new THREE.Vector3(12.5, 9, 14.5);
    camera.position.copy(camBase);
    camera.lookAt(0, -0.3, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8fb8c8, 1.9));
    const sun = new THREE.DirectionalLight(0xfff3d6, 2.4);
    sun.position.set(5, 12, 7);
    scene.add(sun);

    const { island, gem, shadow, clouds, waterTex } = buildIsland();
    const pivot = new THREE.Group();
    pivot.add(island, gem);
    scene.add(pivot, shadow, clouds);

    let visible = false;
    let spinVel = 0;
    let dragging = false;
    let lastX = 0;
    let rotY = -0.5;
    let waterFrame = 0;
    let waterClock = 0;

    canvas.addEventListener('pointerdown', (e) => {
        dragging = true;
        lastX = e.clientX;
        wrap.classList.add('is-dragging');
        canvas.setPointerCapture(e.pointerId);
        requestFrame();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        rotY += dx * 0.012;
        spinVel = dx * 0.6;
        requestFrame();
    });
    const endDrag = () => {
        dragging = false;
        wrap.classList.remove('is-dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        requestFrame();
    }).observe(wrap);

    new ResizeObserver(() => {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // Canvas sempit (mobile) → mundurkan kamera agar pohon tidak terpotong
        camera.position.copy(camBase).multiplyScalar(Math.max(1, 1.3 / camera.aspect));
        camera.lookAt(0, -0.3, 0);
        camera.updateProjectionMatrix();
        requestFrame();
    }).observe(wrap);

    // index-app.js merender ulang #content-area saat navigasi — pasang lagi canvas bila ada .hero baru
    const attach = () => {
        const hero = content.querySelector('.hero');
        if (hero && !hero.contains(wrap)) {
            hero.classList.add('hero--3d');
            hero.appendChild(wrap);
        }
    };
    new MutationObserver(attach).observe(content, { childList: true, subtree: true });
    attach();

    views.add({
        update(t, dt) {
            if (!visible || !wrap.isConnected) return false;
            const motion = reduceMotion ? 0 : 1;

            if (!dragging) {
                rotY += (0.18 * motion + spinVel * 0.02) * dt;
                spinVel *= Math.pow(0.04, dt);
            }
            pivot.rotation.y = rotY;
            pivot.rotation.x = -pointer.y * 0.06 * motion;
            pivot.position.y = Math.sin(t * 1.1) * 0.25 * motion;
            gem.position.set(Math.cos(t * 0.8) * 4, 2.2 + Math.sin(t * 1.6) * 0.4 * motion, Math.sin(t * 0.8) * 4);
            gem.rotation.set(t * 0.7, t * 1.1, 0);
            shadow.scale.setScalar(1 - Math.sin(t * 1.1) * 0.05 * motion);
            clouds.children.forEach((c, i) => {
                c.position.x += Math.sin(t * 0.25 + i * 2) * 0.004 * motion;
            });

            waterClock += dt * motion;
            if (waterClock > 0.12) {
                waterClock = 0;
                waterFrame = (waterFrame + 1) % 32;
                waterTex.offset.y = 1 - (waterFrame + 1) / 64;
            }

            renderer.render(scene, camera);
            return !reduceMotion || dragging || Math.abs(spinVel) > 0.05;
        },
    });
}

/* ------------------------------------------------------------------ */
/* 3. Tilt 3D untuk kartu (DOM) + kilau mengikuti kursor               */
/* ------------------------------------------------------------------ */
const TILT_SEL = '.post-card, .contact-item, .skeleton-card, .login-box';

function initTilt() {
    if (!finePointer || reduceMotion) return;
    let active = null;
    let pending = null;
    let raf = 0;

    const reset = (el) => {
        el.classList.remove('is-tilting');
        ['--rx', '--ry', '--px', '--py', '--gx', '--gy', '--sx', '--sy'].forEach((p) => el.style.removeProperty(p));
    };

    const apply = () => {
        raf = 0;
        if (!pending) return;
        const { el, x, y } = pending;
        const r = el.getBoundingClientRect();
        const px = Math.min(Math.max((x - r.left) / r.width, 0), 1);
        const py = Math.min(Math.max((y - r.top) / r.height, 0), 1);
        const max = el.classList.contains('login-box') ? 6 : 12;
        el.style.setProperty('--rx', `${((0.5 - py) * max).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${((px - 0.5) * max).toFixed(2)}deg`);
        el.style.setProperty('--px', (px - 0.5).toFixed(3));
        el.style.setProperty('--py', (py - 0.5).toFixed(3));
        el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
        el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
        el.style.setProperty('--sx', `${(-(px - 0.5) * 18 + 6).toFixed(1)}px`);
        el.style.setProperty('--sy', `${(-(py - 0.5) * 18 + 10).toFixed(1)}px`);
    };

    document.addEventListener('pointermove', (e) => {
        const el = e.target.closest?.(TILT_SEL);
        if (active && active !== el) reset(active);
        active = el;
        if (!el) return;
        el.classList.add('is-tilting');
        pending = { el, x: e.clientX, y: e.clientY };
        if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });

    document.addEventListener('pointerleave', () => {
        if (active) reset(active);
        active = null;
    });
}

/* ------------------------------------------------------------------ */
/* 4. Reveal 3D saat elemen masuk viewport                             */
/* ------------------------------------------------------------------ */
const REVEAL_SEL = '.hero > h1, .hero > p, .hero > .cta-btns, .section-title, .contact-item, .posts-toolbar, .page-content > *';

function initReveal() {
    const content = document.getElementById('content-area');
    if (!content || reduceMotion || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver((entries) => {
        for (const en of entries) {
            if (!en.isIntersecting) continue;
            en.target.classList.add('r3d-in');
            io.unobserve(en.target);
        }
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    const scan = () => {
        let i = 0;
        content.querySelectorAll(REVEAL_SEL).forEach((el) => {
            if (el.classList.contains('r3d')) return;
            el.classList.add('r3d');
            el.style.setProperty('--d', `${Math.min(i++, 8) * 70}ms`);
            io.observe(el);
        });
    };
    new MutationObserver(scan).observe(content, { childList: true, subtree: true });
    scan();
}

/* ------------------------------------------------------------------ */
if (hasWebGL) {
    try {
        initBackground();
        initHero();
    } catch (e) {
        console.warn('[3d] WebGL scene disabled:', e);
    }
}
initTilt();
initReveal();
requestFrame();
