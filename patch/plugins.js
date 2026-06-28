/**
 * patch/plugins —— 填充 navigator.plugins / navigator.mimeTypes(经典 headless tell:length=0)。
 *
 * 现状[实测]:jsdom 在 Navigator.prototype 以 accessor 暴露 plugins/mimeTypes,但实例为空
 * ([object PluginArray] length=0);真实 Chrome 自统一 PDF viewer 后固定 5 个 plugin × 2 个 mimeType。
 * 这一组是 Chromium 固定集(非设备身份,所有 Chrome 一致),故就地硬编码,类比 sdenv 的 matchMedia 列表。
 * 门控:仅 host=chrome;WebView 真机 plugins 确为空(pdfViewerEnabled=false),跳过即对。
 *
 * 注:navigator.plugins 不在 harness probe 目标内(盲区,value-level),形态靠运行时自测,无真机基线对照。
 * jsdom 的 PluginArray.prototype.length 读内部 slot,空壳 Object.create 取不到 → 改用 mask.iface 自建四类
 * (真机 PluginArray/Plugin/MimeType/MimeTypeArray 确为 illegal constructor),proto 装 native 方法、实例填索引。
 */
import { chromeHost } from './gates.js';

const PDF_DESC = 'Portable Document Format';
const PLUGIN_NAMES = [
  'PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF',
];
const MIME_TYPES = [
  { type: 'application/pdf', suffixes: 'pdf', description: PDF_DESC },
  { type: 'text/pdf', suffixes: 'pdf', description: PDF_DESC },
];

export default {
  name: 'plugins',
  after: ['navigator'],
  applies: chromeHost,
  apply({ window, mask }) {
    const defineMethods = mask.methods;
    // 类数组容器:索引 own 属性(enumerable)+ named(non-enumerable)。length 不落实例,见下:真机 length 在
    // prototype 为 accessor、实例 ownKeys 无 length;装实例 data 会多出真机没有的 own 键(结构 tell)。
    const fillCollection = (arr, items, keyOf) => {
      items.forEach((it, i) => Object.defineProperty(arr, i, { value: it, enumerable: true, configurable: true }));
      for (const it of items) {
        const k = keyOf(it);
        if (k && !(k in arr)) Object.defineProperty(arr, k, { value: it, enumerable: false, configurable: true });
      }
      return arr;
    };

    const Plugin = mask.iface('Plugin');
    const MimeType = mask.iface('MimeType');
    const PluginArray = mask.iface('PluginArray');
    const MimeTypeArray = mask.iface('MimeTypeArray');

    // length 原型 accessor(实例态:读 this 数连续整数索引)—— 三类容器共用一份 getter。
    const lengthGetter = function length() { let n = 0; while (n in this) n += 1; return n; };
    for (const C of [PluginArray, MimeTypeArray, Plugin]) mask.instAccessor(C.proto, 'length', lengthGetter);

    const collMethods = {
      item: [1, function item(i) { return this[i] ?? null; }],
      namedItem: [1, function namedItem(name) { return this[name] ?? null; }],
    };
    defineMethods(PluginArray.proto, { ...collMethods, refresh: [0, () => undefined] });
    defineMethods(MimeTypeArray.proto, collMethods);
    defineMethods(Plugin.proto, collMethods); // Plugin 本身是 mimeType 的类数组容器

    // mimeType 实例(enabledPlugin 稍后回填指向 plugins[0])。
    const mimeInstances = MIME_TYPES.map((m) => MimeType.create({ ...m, enabledPlugin: null }));

    // plugin 实例:每个含全部 mimeType(索引 + named by type),mimeType.enabledPlugin 反指。
    const pluginInstances = PLUGIN_NAMES.map((name) => {
      const plugin = Plugin.create({ name, filename: 'internal-pdf-viewer', description: PDF_DESC });
      fillCollection(plugin, mimeInstances, (mt) => mt.type);
      return plugin;
    });
    for (const mt of mimeInstances) mt.enabledPlugin = pluginInstances[0];

    const plugins = fillCollection(PluginArray.create({}), pluginInstances, (p) => p.name);
    const mimeTypes = fillCollection(MimeTypeArray.create({}), mimeInstances, (mt) => mt.type);

    // 覆盖 Navigator.prototype 的 plugins/mimeTypes accessor 为填充后的单例。
    mask.mixin(window.navigator, { plugins: () => plugins, mimeTypes: () => mimeTypes });
  },
};
