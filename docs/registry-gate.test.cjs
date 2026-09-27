// Mock a canvas 2D context and run the engine's real draw/step loop to
// catch runtime errors that a syntax check cannot see.
const calls = Object.create(null);
function track(name) { return function () { calls[name] = (calls[name] || 0) + 1; }; }
const ctx = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return { width: 400, height: 400 };
    if (k === 'setTransform' || k === 'clearRect' || k === 'beginPath' ||
        k === 'moveTo' || k === 'lineTo' || k === 'closePath' || k === 'stroke' ||
        k === 'fill' || k === 'fillRect' || k === 'strokeRect' || k === 'save' ||
        k === 'restore' || k === 'translate' || k === 'rotate' || k === 'rect' ||
        k === 'fillText' || k === 'strokeText' || k === 'arc' || k === 'clip') return track(k);
    if (k === 'font' || k === 'fillStyle' || k === 'strokeStyle' || k === 'lineWidth' ||
        k === 'globalAlpha' || k === 'textAlign' || k === 'textBaseline' ||
        k === 'shadowBlur' || k === 'shadowColor') return '';
    if (k === 'fillText') return undefined;
    return undefined;
  },
  set(t, k, v) { return true; }
});
const canvas = {
  width: 400, height: 400, clientWidth: 400, clientHeight: 400,
  getContext: () => ctx,
  parentNode: { removeChild() {} },
  style: {}
};
global.window = global;
global.document = { createElement: () => canvas };
global.devicePixelRatio = 2;
global.requestAnimationFrame = () => 1;
global.cancelAnimationFrame = () => {};
global.addEventListener = () => {};
global.IntersectionObserver = undefined;

require(process.argv[2]);
const g = global.RegistryGate.create(canvas, { parallax: false, hud: true });
if (!g) throw new Error('no gate returned');
console.log('records seeded :', g.records.length);
console.log('blocked share  :', g.records.filter(r => r.blocked).length + '/' + g.records.length);

// run 600 simulated steps
for (let i = 0; i < 600; i++) g._step(0.016);
g._draw();
console.log('caught / passed:', g.caught, '/', g.passed);
console.log('states         :', JSON.stringify(g.records.reduce((a, r) => (a[r.state] = (a[r.state]||0)+1, a), {})));

// projection sanity
const p = g._project(0, 0, 0);
console.log('proj origin    :', Math.round(p.x), Math.round(p.y), 'f=' + p.f.toFixed(3));
const near = g._project(0, 0, 2), far = g._project(0, 0, -2);
console.log('perspective ok :', near.f > 1 && far.f < 1 ? 'yes' : 'NO - BUG');

// resize path
g._onResize();
console.log('after resize   :', g.w + 'x' + g.h, 'dpr=' + g.dpr);
console.log('draw calls made:', Object.keys(calls).join(','));
console.log('\nRESULT: engine ran without throwing.');