/**
 * patch/audio.test.js —— Web Audio 壳 realm 自测(harness 不探 audio,故此为其唯一回归门)。
 *   node patch/audio.test.js
 * 跑一条真实 audio 指纹链(new OfflineAudioContext → createOscillator/createDynamicsCompressor → connect 链 →
 * start → startRendering()→await AudioBuffer → getChannelData),验收**结构**(非指纹值,见 audio.js"已知未尽项"):
 * typeof/可构造/instanceof(含继承 AudioNode)/AudioParam/链式 connect/Promise<AudioBuffer>/Float32Array/方法 native。
 * CODE 为 async IIFE,返回 window-realm Promise → Node 端 await r.value flush microtask 拿完整渲染路径。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const CODE = `(async () => {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const osc = ctx.createOscillator();
  osc.type = 'triangle'; osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-50, ctx.currentTime);
  const gain = ctx.createGain();
  const connectRet = osc.connect(comp);
  comp.connect(gain); gain.connect(ctx.destination);
  osc.start(0);
  // FingerprintJS2 主路径:oncomplete / addEventListener('complete'),非 await
  let ocRan = false, ocBufferOk = false, listenerRan = false;
  const ocDefaultNull = ctx.oncomplete === null;
  const ocOwnBefore = Object.prototype.hasOwnProperty.call(ctx, 'oncomplete');
  ctx.oncomplete = (e) => { ocRan = true; ocBufferOk = e.renderedBuffer instanceof AudioBuffer; };
  const ocOwnAfter = Object.prototype.hasOwnProperty.call(ctx, 'oncomplete');
  const ocProtoDesc = Object.getOwnPropertyDescriptor(OfflineAudioContext.prototype, 'oncomplete');
  ctx.addEventListener('complete', () => { listenerRan = true; });
  const rendering = ctx.startRendering();
  const buffer = await rendering;
  await Promise.resolve(); await Promise.resolve(); // flush complete 事件 fire
  const data = buffer.getChannelData(0);
  // offline 渲染后 state → 'closed'(真机单向转换)
  const offline_state_after = ctx.state;
  // 实时 AudioContext 壳:原仅被 typeof/别名触及,从不运行 state/baseLatency/工厂/close-suspend-resume
  const rt = new AudioContext();
  const rt_state = rt.state;
  const rt_baseLatency = rt.baseLatency;
  const rt_osc_ok = rt.createOscillator() instanceof OscillatorNode;
  const rt_suspend_p = rt.suspend() instanceof Promise;
  const rt_resume_p = rt.resume() instanceof Promise;
  const rt_close_p = rt.close() instanceof Promise;
  return {
    offline_state_after, rt_state, rt_baseLatency, rt_osc_ok, rt_suspend_p, rt_resume_p, rt_close_p,
    has_addEventListener: typeof ctx.addEventListener,
    ocRan, ocBufferOk, listenerRan, ocDefaultNull, ocOwnBefore, ocOwnAfter,
    ocProtoAccessor: !!ocProtoDesc && typeof ocProtoDesc.get === 'function' && typeof ocProtoDesc.set === 'function',
    typeof_OfflineAudioContext: typeof OfflineAudioContext,
    typeof_AudioContext: typeof AudioContext,
    typeof_AudioBuffer: typeof AudioBuffer,
    ctx_instanceof: ctx instanceof OfflineAudioContext,
    ctx_tag: Object.prototype.toString.call(ctx),
    osc_instanceof_Oscillator: osc instanceof OscillatorNode,
    osc_instanceof_AudioNode: osc instanceof AudioNode,
    freq_isAudioParam: osc.frequency instanceof AudioParam,
    freq_value_writable: osc.frequency.value === 10000,
    comp_instanceof: comp instanceof DynamicsCompressorNode,
    connect_chains: connectRet === comp,
    dest_instanceof: ctx.destination instanceof AudioDestinationNode,
    // 节点标量拓扑(真机实测,缺则 undefined → tell):值随节点类型而异
    osc_ni: osc.numberOfInputs, osc_no: osc.numberOfOutputs, osc_ccm: osc.channelCountMode, osc_ci: osc.channelInterpretation,
    comp_ccm: comp.channelCountMode, dest_no: ctx.destination.numberOfOutputs,
    osc_context_is_ctx: osc.context === ctx,
    param_autorate: osc.frequency.automationRate,
    // 真机这些是 AudioNode.prototype 访问器(非节点 own)
    ni_not_own: !Object.prototype.hasOwnProperty.call(osc, 'numberOfInputs'),
    rendering_isPromise: rendering instanceof Promise,
    buffer_instanceof: buffer instanceof AudioBuffer,
    data_isFloat32: data instanceof Float32Array,
    data_len: data.length,
    buffer_len: buffer.length,
    buffer_sampleRate: buffer.sampleRate,
    getChannelData_native: buffer.getChannelData.toString(),
    createOscillator_native: ctx.createOscillator.toString(),
    new_no_arg_throws: (() => { try { OfflineAudioContext(1,1,1); return false; } catch (e) { return e instanceof TypeError; } })(),
    // 构造器错误文本:真机 .message 带前缀 + 完整尾句,.stack 首行剥前缀
    oac_msg: (() => { try { OfflineAudioContext(1,1,1); return ''; } catch (e) { return e.message; } })(),
    oac_stack_hasPrefix: (() => { try { OfflineAudioContext(1,1,1); return null; } catch (e) { return e.stack.indexOf('Failed to construct') !== -1; } })(),
    webkit_alias: window.webkitAudioContext === AudioContext,
    webkitOffline_alias: window.webkitOfflineAudioContext === OfflineAudioContext,
    // 接口原型 own 键序:真机 WebIDL constructor 恒末位
    ctorlast_oac: (() => { const k = Object.getOwnPropertyNames(OfflineAudioContext.prototype); return k[k.length - 1] === 'constructor' && k[0] !== 'constructor'; })(),
    ctorlast_osc: (() => { const k = Object.getOwnPropertyNames(OscillatorNode.prototype); return k[k.length - 1] === 'constructor'; })(),
    ctorlast_param: (() => { const k = Object.getOwnPropertyNames(AudioParam.prototype); return k[k.length - 1] === 'constructor'; })(),
  };
})()`;

const realm = await Realm.create({ profile: 'macos-chrome-v148' });
const r = realm.run(CODE);
if (!r.ok) { ok('realm 执行成功', false); console.log(`    ${r.error}`); realm.dispose(); process.exit(1); }
let v;
try { v = await r.value; } catch (e) { ok('async 渲染链 await 成功', false); console.log(`    ${e && e.message}`); realm.dispose(); process.exit(1); }
console.log('\n[Web Audio 壳]');
ok('typeof OfflineAudioContext === function', v.typeof_OfflineAudioContext === 'function');
ok('typeof AudioContext === function', v.typeof_AudioContext === 'function');
ok('typeof AudioBuffer === function', v.typeof_AudioBuffer === 'function');
ok('new OfflineAudioContext(...) → instanceof', v.ctx_instanceof === true);
ok('tag [object OfflineAudioContext]', v.ctx_tag === '[object OfflineAudioContext]');
ok('createOscillator → instanceof OscillatorNode', v.osc_instanceof_Oscillator === true);
ok('OscillatorNode 继承 AudioNode(instanceof AudioNode)', v.osc_instanceof_AudioNode === true);
ok('osc.frequency instanceof AudioParam', v.freq_isAudioParam === true);
ok('AudioParam.value 可写(=10000)', v.freq_value_writable === true);
ok('createDynamicsCompressor → instanceof', v.comp_instanceof === true);
ok('node.connect(node) 返回被连 node(链式)', v.connect_chains === true);
ok('ctx.destination instanceof AudioDestinationNode', v.dest_instanceof === true);
console.log('\n[节点标量拓扑 — 真机实测,缺则 undefined]');
ok('OscillatorNode numberOfInputs=0/numberOfOutputs=1', v.osc_ni === 0 && v.osc_no === 1);
ok('OscillatorNode channelCountMode=max channelInterpretation=speakers', v.osc_ccm === 'max' && v.osc_ci === 'speakers');
ok('DynamicsCompressorNode channelCountMode=clamped-max(异于 max)', v.comp_ccm === 'clamped-max');
ok('AudioDestinationNode numberOfOutputs=0', v.dest_no === 0);
ok('node.context === 创建它的 context', v.osc_context_is_ctx === true);
ok('AudioParam.automationRate === a-rate', v.param_autorate === 'a-rate');
ok('numberOfInputs 非节点 own(住 AudioNode.prototype,真机如此)', v.ni_not_own === true);
ok('startRendering() instanceof window.Promise', v.rendering_isPromise === true);
ok('await → AudioBuffer 实例', v.buffer_instanceof === true);
ok('getChannelData(0) instanceof window.Float32Array', v.data_isFloat32 === true);
ok('getChannelData 长度 = ctx length (44100)', v.data_len === 44100);
ok('AudioBuffer.length = 44100', v.buffer_len === 44100);
ok('AudioBuffer.sampleRate = 44100', v.buffer_sampleRate === 44100);
ok('getChannelData toString 为 native', v.getChannelData_native === 'function getChannelData() { [native code] }');
ok('createOscillator toString 为 native', v.createOscillator_native === 'function createOscillator() { [native code] }');
ok('OfflineAudioContext(...) 无 new 抛 TypeError', v.new_no_arg_throws === true);
ok('OAC 无 new .message 带前缀+完整尾句(真机形态)', v.oac_msg === "Failed to construct 'OfflineAudioContext': Please use the 'new' operator, this DOM object constructor cannot be called as a function.");
ok('OAC 无 new .stack 首行**不含**前缀(message≠stack-head 分叉)', v.oac_stack_hasPrefix === false);
ok('window.webkitAudioContext === AudioContext', v.webkit_alias === true);
ok('window.webkitOfflineAudioContext === OfflineAudioContext', v.webkitOffline_alias === true);
ok('OfflineAudioContext.prototype own 键 constructor 在末位(真机 WebIDL 序)', v.ctorlast_oac === true);
ok('OscillatorNode.prototype own 键 constructor 在末位', v.ctorlast_osc === true);
ok('AudioParam.prototype own 键 constructor 在末位', v.ctorlast_param === true);
console.log('\n[oncomplete/addEventListener 主对手路径 — FingerprintJS2]');
ok('ctx.addEventListener 存在(非 undefined → 不崩)', v.has_addEventListener === 'function');
ok('oncomplete 默认 null 且 prototype accessor 可写', v.ocDefaultNull === true && v.ocProtoAccessor === true);
ok('oncomplete 赋值不产生实例 own key', v.ocOwnBefore === false && v.ocOwnAfter === false);
ok('oncomplete 回调触发(非静默 no-op)', v.ocRan === true);
ok('oncomplete 事件 e.renderedBuffer instanceof AudioBuffer', v.ocBufferOk === true);
ok('addEventListener("complete") 监听触发', v.listenerRan === true);
console.log('\n[OfflineAudioContext 渲染后状态 + 实时 AudioContext 壳]');
ok('offline 渲染后 state === "closed"(真机单向转换,曾恒 suspended)', v.offline_state_after === 'closed');
ok('实时 AudioContext.state === "running"', v.rt_state === 'running');
ok('实时 AudioContext.baseLatency === 0', v.rt_baseLatency === 0);
ok('实时 createOscillator → OscillatorNode', v.rt_osc_ok === true);
ok('实时 suspend()/resume()/close() 均返 Promise', v.rt_suspend_p && v.rt_resume_p && v.rt_close_p);
realm.dispose();

console.log(`\nWeb Audio 壳自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
