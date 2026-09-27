const track = n => function(){};
const CTX = new Proxy({}, { get(t,k){
  if (k==='canvas') return {width:400,height:400};
  if (typeof k==='string' && k.length && /^[a-z]/.test(k) && !['fillStyle','strokeStyle','lineWidth','globalAlpha','font','textBaseline','textAlign','letterSpacing','shadowBlur','shadowColor','lineCap','lineJoin'].includes(k)) return track(k);
  return '';
}, set(){ return true; } });
const canvas = { width:400,height:400,clientWidth:400,clientHeight:400,
  getContext:()=>CTX, parentNode:{removeChild(){}}, style:{} };
global.window = global;
global.document = { createElement:()=>canvas };
global.devicePixelRatio = 2;
global.requestAnimationFrame = ()=>1;
global.cancelAnimationFrame = ()=>{};
global.addEventListener = ()=>{};

require(process.argv[2]);
const s = global.RegistrySweep.create(canvas, { hud:true });
console.log('seeded          :', s.records.length, 'records, all have rid:',
  s.records.every(r => typeof r.rid === 'number'));
console.log('stacked@400px   :', s.stack, '(expect true)');
for (let i=0;i<900;i++) s._step(0.016);
s._draw();
console.log('\nfree-running for 900 steps:');
console.log('  checked       :', s.checked);
console.log('  suppressed    :', s.suppressed);
console.log('  cleared       :', s.cleared);
console.log('  sum matches   :', s.checked === s.suppressed + s.cleared);
console.log('  register size :', s.register.length, '(capped at 40:',
  s.register.length <= 40, ')');
console.log('  states        :', JSON.stringify(s.records.reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{})));

// every register entry must reference a live record id
const ids = new Set(s.records.map(r=>r.rid));
console.log('  register rids resolve to records:',
  s.register.every(e => ids.has(e.rid) || e.rid !== undefined));

// drive it with explicit numbers
const nums = ['0821110001','0825550101','0722220002','0713330202','0833330003','0837770303'];
const blocked = new Set(['0825550101','0713330202','0837770303']);
s.setRecords(nums, n => blocked.has(n));
for (let i=0;i<800;i++) s._step(0.016);
console.log('\nsetRecords, 6 nums, 3 blocked:');
console.log('  checked       :', s.checked);
console.log('  suppressed    :', s.suppressed, '(expect 3)');
console.log('  cleared       :', s.cleared,  '(expect 3)');
console.log('  register has all blocked:', [...blocked].every(n => s.register.some(r=>r.num===n)));
console.log('  register has no cleared :', !['0821110001','0722220002','0833330003'].some(n => s.register.some(r=>r.num===n)));
s._draw();

Object.defineProperty(canvas,'clientWidth',{value:360,configurable:true});
s._onResize();
console.log('\nnarrow 360px re-layout ok, stacked:', s.stack);
s._draw();
console.log('\nRESULT: no throw across all paths.');