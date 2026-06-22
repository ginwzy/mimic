/**
 * trace/detector —— 缺失 API 检测,从运行错误反推脚本需要什么。
 * 取代旧 env/core/AutoDetector.js。
 */
const PATTERNS = [
  [/(\w[\w.]*) is not defined/, 'not_defined'],
  [/Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)/, 'prop_of_undefined'],
  [/([^\s]+) is not a function/, 'not_a_function'],
  [/([^\s]+) is not a constructor/, 'not_a_constructor'],
];

export class Detector {
  constructor(window) {
    this.window = window;
    this.errors = [];
    this._missing = new Set();
  }

  captureError(err) {
    const msg = err?.message ?? String(err);
    for (const [re, category] of PATTERNS) {
      const m = msg.match(re);
      if (m) {
        this._missing.add(m[1]);
        this.errors.push({ api: m[1], category, message: msg });
        return;
      }
    }
    this.errors.push({ api: null, category: 'unknown', message: msg });
  }

  patchError(name, err) {
    this.errors.push({ api: null, category: 'patch', message: `[patch:${name}] ${err.message}` });
  }

  missing() {
    return [...this._missing];
  }

  /** 缺失 API → 建议加载的 patch(简版关键字映射)。 */
  suggest() {
    const joined = this.missing().join(' ');
    const hints = [];
    if (/canvas|getContext|toDataURL/i.test(joined)) hints.push('canvas');
    if (/webgl|getParameter/i.test(joined)) hints.push('webgl');
    if (/Audio(Context)?|createOscillator/i.test(joined)) hints.push('audio');
    if (/chrome/i.test(joined)) hints.push('chrome');
    return hints;
  }
}
