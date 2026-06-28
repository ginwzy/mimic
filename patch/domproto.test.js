/**
 * patch/domproto.test.js —— crasher 反射访问器默认值自测。
 *   node patch/domproto.test.js
 *
 * 守住 reflectAccessor 分流后的两面契约:
 *   ① crasher 子集(adoptedStyleSheets/innerText/outerText/part)默认值为正确类型,页面 init 阶段的正常使用
 *      (for...of / 展开 / .trim() / .length / .add() / .contains())**不抛** —— null 默认下这些操作会抛、
 *      中断 sensor 前的执行。本测打的就是这些字面崩溃操作,而非仅 typeof。
 *   ② 回归:on* 处理器仍走 eventHandler(默认 null、可写);crasher 属性形态未变(get 'get X'/0、set 'set X'/1、
 *      get native),故 L1 形态零变化(diff-gate 不受影响,由 diff-gate.test.js 另守)。
 */
import { Realm } from '../core/realm.js';

let pass = 0; let failed = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const r = await Realm.create({ profile: 'chrome-mac' });
const R = r.run(`(function(){
  const noThrow = (fn) => { try { fn(); return true; } catch (e) { return false; } };
  const el = document.createElement('div');
  const itGet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').get;
  const itSet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').set;
  return {
    // adoptedStyleSheets (Document) —— null 上 for...of/展开抛
    ass_type: typeof document.adoptedStyleSheets,
    ass_isArray: Array.isArray(document.adoptedStyleSheets),
    ass_iter: noThrow(function(){ for (const s of document.adoptedStyleSheets) {} }),
    ass_spread: noThrow(function(){ return [...document.adoptedStyleSheets]; }),
    ass_assign: noThrow(function(){ document.adoptedStyleSheets = []; }),

    // part (Element) —— null 上 .add()/.contains()/for...of 抛
    part_type: typeof el.part,
    part_add: noThrow(function(){ el.part.add('x'); }),
    part_contains: noThrow(function(){ return el.part.contains('x'); }),
    part_iter: noThrow(function(){ for (const p of el.part) {} }),
    part_spread: noThrow(function(){ return [...el.part]; }),
    part_value_str: typeof el.part.value === 'string',
    part_assign: noThrow(function(){ el.part = ''; }),

    // innerText / outerText (HTMLElement) —— null 上 .trim()/.length 抛
    it_type: typeof el.innerText,
    it_trim: noThrow(function(){ return el.innerText.trim(); }),
    it_len: noThrow(function(){ return el.innerText.length; }),
    it_assign: noThrow(function(){ el.innerText = 'x'; }),
    ot_type: typeof el.outerText,
    ot_trim: noThrow(function(){ return el.outerText.trim(); }),
    // 默认取 this.textContent(getDefault 以 this=实例 调用;getter 经 get-syntax 既绑 this 又无 .prototype)
    it_reflectsTextContent: (function(){ const d = document.createElement('div'); d.textContent = 'hello'; return d.innerText; })(),

    // 回归:on* 仍默认 null 且可写(eventHandler 路径未变)
    onsearch_null: document.onsearch === null,
    onsearch_writable: (function(){ document.onsearch = function f(){}; return typeof document.onsearch === 'function'; })(),

    // cosmetic 反射默认值(reflectAccessor 非 null 默认;值对照 sdenv)。默认读须在下方 cos_assign_noThrow 之前
    // (赋值已 round-trip 入 per-instance 存储,会改写后续读)。
    cos_designMode: document.designMode,
    cos_domain: document.domain, cos_locHost: location.hostname,
    cos_contentEditable: el.contentEditable,
    cos_spellcheck: el.spellcheck,
    cos_autofocus: el.autofocus,
    cos_inert: el.inert,
    cos_fullscreenEnabled: document.fullscreenEnabled,
    cos_autocapitalize: el.autocapitalize,
    cos_enterKeyHint: el.enterKeyHint,
    cos_inputMode: el.inputMode,
    cos_alinkColor: document.alinkColor,
    cos_bgColor: document.bgColor,
    cos_fgColor: document.fgColor,
    cos_linkColor: document.linkColor,
    cos_vlinkColor: document.vlinkColor,
    cos_assign_noThrow: noThrow(function(){ document.designMode = 'on'; el.spellcheck = false; document.bgColor = '#fff'; }),
    // 形态:moved 键仍 get+set('get X'/0、'set X'/1、get native)— 迁移路径(eventHandler→reflectAccessor)不改形态
    dm_getName: Object.getOwnPropertyDescriptor(Document.prototype, 'designMode').get.name,
    dm_getLen: Object.getOwnPropertyDescriptor(Document.prototype, 'designMode').get.length,
    dm_setName: Object.getOwnPropertyDescriptor(Document.prototype, 'designMode').set.name,
    dm_setLen: Object.getOwnPropertyDescriptor(Document.prototype, 'designMode').set.length,
    dm_getNative: Object.getOwnPropertyDescriptor(Document.prototype, 'designMode').get.toString().includes('[native code]'),

    // 形态:crasher 属性 get/set name+length 仍 'get X'/0、'set X'/1;get 为 native(无源码泄漏)
    it_getName: itGet.name, it_getLen: itGet.length,
    it_setName: itSet.name, it_setLen: itSet.length,
    it_getNative: itGet.toString().includes('[native code]'),

    // ── ② 回写:per-instance round-trip / readonly opt-out ──
    // part:[PutForwards] — 赋值前向 value setter,读回**仍 DOMTokenList**(锁 crasher 不复活,最关键)
    rt_part_obj: (function(){ const d = document.createElement('div'); d.part = 'x'; return typeof d.part === 'object'; })(),
    rt_part_noThrow: (function(){ const d = document.createElement('div'); d.part = 'x';
      return noThrow(function(){ d.part.add('y'); d.part.contains('x'); for (const p of d.part) {} }); })(),
    // fullscreenEnabled:真机 readonly — 赋值静默忽略,读回不变(仍 true)
    rt_fse_readonly: (function(){ try { document.fullscreenEnabled = false; } catch (e) {} return document.fullscreenEnabled === true; })(),
    // 普通 cosmetic round-trip(逐字存,正常类型值即反映)
    rt_contentEditable: (function(){ const d = document.createElement('div'); d.contentEditable = 'true'; return d.contentEditable; })(),
    rt_designMode: (function(){ document.designMode = 'on'; return document.designMode === 'on'; })(),
    // adoptedStyleSheets round-trip(同一数组引用)
    rt_ass_identity: (function(){ const arr = []; document.adoptedStyleSheets = arr; return document.adoptedStyleSheets === arr; })(),
    // per-instance 隔离:a 存值不污染未写的 b(b 仍读默认 'inherit')
    rt_perInstance: (function(){ const a = document.createElement('div'), b = document.createElement('div');
      a.contentEditable = 'false'; return a.contentEditable === 'false' && b.contentEditable === 'inherit'; })(),
    // crasher 子集 coerce 保型:不兼容值入存后用时**不抛**(锁 crasher 不因回写复活)
    cz_it_null: (function(){ const d = document.createElement('div'); d.innerText = null;
      return noThrow(function(){ d.innerText.trim(); }) && d.innerText === ''; })(),  // null→'' 合 LegacyNullToEmptyString
    cz_it_num: (function(){ const d = document.createElement('div'); d.innerText = 123;
      return d.innerText === '123' && noThrow(function(){ d.innerText.length; }); })(),  // 数字→string
    cz_ot_null: (function(){ const d = document.createElement('div'); d.outerText = null;
      return noThrow(function(){ d.outerText.trim(); }); })(),
    cz_ass_null: (function(){ document.adoptedStyleSheets = null;
      return noThrow(function(){ for (const s of document.adoptedStyleSheets) {} return [...document.adoptedStyleSheets]; })
        && Array.isArray(document.adoptedStyleSheets)
        && document.adoptedStyleSheets instanceof window.Array; })(),  // 非数组退空数组、可迭代、且兜底对齐 sandbox realm

    // ── ③ part:per-instance 真实 DOMTokenList(复用 jsdom classList 工厂,绑 part attribute)──
    p3_sameStable: (function(){ const a = document.createElement('div'); return a.part === a.part; })(),
    p3_distinct: (function(){ const a = document.createElement('div'), b = document.createElement('div'); return a.part !== b.part; })(),
    p3_emptyOwn: (function(){ return Object.getOwnPropertyNames(document.createElement('div').part).length; })(),  // 0:方法全在 prototype
    p3_protoDTL: (function(){ return Object.getPrototypeOf(document.createElement('div').part) === window.DOMTokenList.prototype; })(),
    p3_attrToList: (function(){ const a = document.createElement('div'); a.setAttribute('part', 'a b');
      return a.part.length === 2 && a.part.contains('a') && a.part.item(0) === 'a' && [...a.part].join(',') === 'a,b'; })(),
    p3_listToAttr: (function(){ const a = document.createElement('div'); a.setAttribute('part', 'a b'); a.part.add('c'); return a.getAttribute('part') === 'a b c'; })(),
    p3_putForwards: (function(){ const a = document.createElement('div'); a.part = 'x y'; return a.getAttribute('part') === 'x y' && [...a.part].join(',') === 'x,y'; })(),
    p3_pfNull: (function(){ const a = document.createElement('div'); a.part = null; return a.getAttribute('part'); })(),  // jsdom 真实 setter:DOMString(null)='null'
    p3_addEmptyThrows: (function(){ try { document.createElement('div').part.add(''); return false; } catch (e) { return e.name === 'SyntaxError'; } })(),
    p3_addSpaceThrows: (function(){ try { document.createElement('div').part.add('a b'); return false; } catch (e) { return e.name === 'InvalidCharacterError'; } })(),
  };
})()`).value;

console.log('[adoptedStyleSheets:数组默认,for...of/展开/赋值不抛]');
ok('typeof 为 object', R.ass_type === 'object');
ok('Array.isArray 成立', R.ass_isArray === true);
ok('for...of 不抛', R.ass_iter === true);
ok('展开不抛', R.ass_spread === true);
ok('赋值不抛', R.ass_assign === true);

console.log('\n[part:真实 DOMTokenList,.add()/.contains()/for...of 不抛]');
ok('typeof 为 object', R.part_type === 'object');
ok('.add() 不抛', R.part_add === true);
ok('.contains() 不抛', R.part_contains === true);
ok('for...of 不抛', R.part_iter === true);
ok('展开不抛', R.part_spread === true);
ok('.value 为 string', R.part_value_str === true);
ok('赋值不抛', R.part_assign === true);

console.log('\n[innerText/outerText:string 默认,.trim()/.length 不抛]');
ok('innerText typeof string', R.it_type === 'string');
ok('innerText.trim() 不抛', R.it_trim === true);
ok('innerText.length 不抛', R.it_len === true);
ok('innerText 赋值不抛', R.it_assign === true);
ok('outerText typeof string', R.ot_type === 'string');
ok('outerText.trim() 不抛', R.ot_trim === true);
ok('innerText 默认反映 this.textContent', R.it_reflectsTextContent === 'hello');

console.log('\n[回归:on* 仍默认 null 且可写]');
ok('document.onsearch === null', R.onsearch_null === true);
ok('document.onsearch 可写', R.onsearch_writable === true);

console.log('\n[形态:get/set name+length 不变 + get native]');
ok("get name 为 'get innerText'", R.it_getName === 'get innerText');
ok('get length 为 0', R.it_getLen === 0);
ok("set name 为 'set innerText'", R.it_setName === 'set innerText');
ok('set length 为 1', R.it_setLen === 1);
ok('get 为 native', R.it_getNative === true);

console.log('\n[cosmetic:非 null 默认值(对照 sdenv)+ 赋值不抛 + 形态不变]');
ok("designMode 默认 'off'", R.cos_designMode === 'off');
ok('domain 默认 location.hostname', R.cos_domain === R.cos_locHost && typeof R.cos_domain === 'string');
ok("contentEditable 默认 'inherit'", R.cos_contentEditable === 'inherit');
ok('spellcheck 默认 true', R.cos_spellcheck === true);
ok('autofocus 默认 false', R.cos_autofocus === false);
ok('inert 默认 false', R.cos_inert === false);
ok('fullscreenEnabled 默认 true', R.cos_fullscreenEnabled === true);
ok("autocapitalize 默认 ''", R.cos_autocapitalize === '');
ok("enterKeyHint 默认 ''", R.cos_enterKeyHint === '');
ok("inputMode 默认 ''", R.cos_inputMode === '');
ok("alinkColor 默认 ''", R.cos_alinkColor === '');
ok("bgColor 默认 ''", R.cos_bgColor === '');
ok("fgColor 默认 ''", R.cos_fgColor === '');
ok("linkColor 默认 ''", R.cos_linkColor === '');
ok("vlinkColor 默认 ''", R.cos_vlinkColor === '');
ok('cosmetic 赋值不抛', R.cos_assign_noThrow === true);
ok("designMode get name 为 'get designMode'", R.dm_getName === 'get designMode');
ok('designMode get length 为 0', R.dm_getLen === 0);
ok("designMode set name 为 'set designMode'", R.dm_setName === 'set designMode');
ok('designMode set length 为 1', R.dm_setLen === 1);
ok('designMode get 为 native', R.dm_getNative === true);

console.log('\n[② 回写:per-instance round-trip / readonly opt-out]');
ok('part 赋值后仍 object(不复活 crasher)', R.rt_part_obj === true);
ok('part 赋值后 .add()/.contains()/for...of 不抛', R.rt_part_noThrow === true);
ok('fullscreenEnabled readonly:赋值后仍 true', R.rt_fse_readonly === true);
ok("contentEditable round-trip 'true'", R.rt_contentEditable === 'true');
ok("designMode round-trip 'on'", R.rt_designMode === true);
ok('adoptedStyleSheets round-trip 同一数组', R.rt_ass_identity === true);
ok('per-instance 隔离(a 写不污染 b)', R.rt_perInstance === true);

console.log('\n[② coerce 保型:不兼容值入存后不复活 crasher]');
ok("innerText=null 后 .trim() 不抛且为 ''", R.cz_it_null === true);
ok("innerText=123 后为 '123'、.length 不抛", R.cz_it_num === true);
ok('outerText=null 后 .trim() 不抛', R.cz_ot_null === true);
ok('adoptedStyleSheets=null 后仍数组、for...of/展开不抛', R.cz_ass_null === true);

console.log('\n[③ part:per-instance 真实 DOMTokenList — 空实例/方法在 prototype/attr 双向联动/PutForwards]');
ok('el.part === el.part(per-instance 稳定身份)', R.p3_sameStable === true);
ok('不同元素 part 互异(非单例)', R.p3_distinct === true);
ok('实例无 own data 方法(全在 prototype)', R.p3_emptyOwn === 0);
ok('getPrototypeOf === DOMTokenList.prototype', R.p3_protoDTL === true);
ok('attribute → DTL live(setAttribute 后真 token 集)', R.p3_attrToList === true);
ok('DTL → attribute 写回(add 反映 part attr)', R.p3_listToAttr === true);
ok('PutForwards round-trip(el.part=str 落地 attr)', R.p3_putForwards === true);
ok("PutForwards DOMString 转换(null→'null')", R.p3_pfNull === 'null');
ok('add("") 抛 SyntaxError(保真,非回归)', R.p3_addEmptyThrows === true);
ok('add("a b") 抛 InvalidCharacterError(保真,非回归)', R.p3_addSpaceThrows === true);

r.dispose();

console.log(`\ndomproto 反射访问器自测:${pass} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
