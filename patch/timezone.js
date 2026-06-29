/**
 * patch/timezone —— 时区回放:让 Intl/Date 报告 profile.timezone 的 IANA 区,而非宿主机时区。
 *
 * 根因:jsdom/Node 的 Date 与 Intl 默认走宿主 ICU 时区(开发机 Asia/Shanghai),直接泄漏真实地理位置。
 * Akamai 等强检测把三处交叉比对,任一不一致即破:
 *   new Date().getTimezoneOffset() · Intl.DateTimeFormat().resolvedOptions().timeZone · Date.toString() 的 GMT 偏移。
 * profile.timezone{timeZone,offset} 真机采集已有(collect.js timezone 段),此前无 patch 消费。
 *
 * 一致性是关键(检测器靠"内部自相矛盾"识别伪装):getTimezoneOffset / toString 家族 / toLocale* /
 * Intl.DateTimeFormat 全部口径统一到同一目标区,且 DST 正确 —— 按各 Date 实例的真实时刻在目标区现算偏移,
 * 不套 profile 里那个固定的 capture-time offset(那是采集瞬时值,跨 DST 会与当下矛盾)。计算借宿主 Intl 的
 * timeZone 选项完成(与宿主默认区解耦),故无需改 ICU 全局态、无需 per-realm 设 TZ。
 */
export default {
  name: 'timezone',
  after: [],
  applies: (t) => t.engine === 'chromium',
  apply({ window, profile, mask }) {
    const tz = profile.get('timezone.timeZone', null);
    if (!tz) return; // 未采时区 → 不接管,保持宿主真实(不投机造区)

    const RealDate = window.Date;
    const RealDTF = window.Intl.DateTimeFormat;
    const DateProto = RealDate.prototype;
    const valid = (ms) => Number.isFinite(ms);

    // 借真 DTF 在目标区取墙钟分量(formatToParts 的 timeZone 选项与宿主默认区无关)。
    const partsOf = (ms, opts) => {
      const o = {};
      for (const p of new RealDTF('en-US', { timeZone: tz, hour12: false, ...opts }).formatToParts(new RealDate(ms))) o[p.type] = p.value;
      return o;
    };
    // getTimezoneOffset 口径:UTC - local(东区为负)。把目标区墙钟当作 UTC 反解 → ms 与之差即偏移。
    const offsetMin = (ms) => {
      const o = partsOf(ms, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const asUTC = RealDate.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
      return Math.round((ms - asUTC) / 60000);
    };
    const gmtStr = (ms) => {
      const off = offsetMin(ms);
      const a = Math.abs(off);
      return `GMT${off <= 0 ? '+' : '-'}${String((a / 60) | 0).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
    };
    const longName = (ms) => partsOf(ms, { timeZoneName: 'long' }).timeZoneName || tz;

    // toString 家族不接受 options → 按目标区手工拼("Tue Apr 01 2025 03:00:00 GMT+0300 (Eastern European Summer Time)")。
    const dp = (ms) => partsOf(ms, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = (ms) => { const p = dp(ms); return `${p.weekday} ${p.month} ${p.day} ${p.year}`; };
    const timeStr = (ms) => { const p = dp(ms); return `${p.hour}:${p.minute}:${p.second} ${gmtStr(ms)} (${longName(ms)})`; };

    mask.hook(DateProto, 'getTimezoneOffset', () => function getTimezoneOffset() {
      const ms = this.getTime();
      return valid(ms) ? offsetMin(ms) : NaN;
    });
    mask.hook(DateProto, 'toString', () => function toString() {
      const ms = this.getTime();
      return valid(ms) ? `${dateStr(ms)} ${timeStr(ms)}` : 'Invalid Date';
    });
    mask.hook(DateProto, 'toDateString', () => function toDateString() {
      const ms = this.getTime();
      return valid(ms) ? dateStr(ms) : 'Invalid Date';
    });
    mask.hook(DateProto, 'toTimeString', () => function toTimeString() {
      const ms = this.getTime();
      return valid(ms) ? timeStr(ms) : 'Invalid Date';
    });
    // toLocale* 接受 options.timeZone → 缺省注入目标区,口径与上面统一(真实 toLocale* 即按该区格式化)。
    for (const m of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
      mask.hook(DateProto, m, (orig) => function (locales, options) {
        const o = options == null ? {} : { ...options };
        if (o.timeZone == null) o.timeZone = tz;
        return orig.call(this, locales, o);
      });
    }

    // Intl.DateTimeFormat:构造时缺省注入目标区 → resolvedOptions().timeZone 与 format/formatToParts/formatRange 全部归一。
    // 显式传 timeZone 的调用方不受影响(只在缺省时注入)。
    function DateTimeFormat(locales, options) {
      const o = options == null ? {} : { ...options };
      if (o.timeZone == null) o.timeZone = tz;
      return new.target ? Reflect.construct(RealDTF, [locales, o]) : RealDTF(locales, o);
    }
    // 保形:复用真原型(instanceof + 原型方法链不变),静态 supportedLocalesOf 转发,构造器身份回指本壳。
    Object.defineProperty(DateTimeFormat, 'prototype', { value: RealDTF.prototype, writable: false, enumerable: false, configurable: false });
    Object.defineProperty(RealDTF.prototype, 'constructor', { value: DateTimeFormat, writable: true, enumerable: false, configurable: true });
    DateTimeFormat.supportedLocalesOf = mask.native((...a) => RealDTF.supportedLocalesOf(...a), 'supportedLocalesOf', RealDTF.supportedLocalesOf.length);
    mask.native(DateTimeFormat, 'DateTimeFormat', RealDTF.length);
    window.Intl.DateTimeFormat = DateTimeFormat;
  },
};
