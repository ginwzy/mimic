/**
 * patch/chrome —— 注入 window.chrome(Chrome 特有,WebView 无)+ 标准扩展键 loadTimes/csi/app。
 * 门控:仅 host=chrome 生效;WebView(host=webview)自动跳过 → window.chrome 不存在。
 * 对照 sdenv: browser/chrome/chrome.js
 *
 * own 键集恰为 [loadTimes, csi, app](真机[实测,L1 基线]:仅此三键,无 runtime —— 真机无扩展页面时
 * window.chrome 无 runtime 键;注入 {runtime:{}} 即过度注入,检测器 'runtime' in chrome 一测即破)。
 *
 * loadTimes/csi 形态特殊[实测]:name='' / length=0 / toString 为 native code,却**带 .prototype**
 * (ownNames=length,name,prototype)—— 是老式 native 函数,异于多数无 .prototype 的 native 方法。故用普通
 * function(非箭头)过 native():native 不剥 .prototype → hasPrototype=true 自然成立;若用箭头则 .prototype
 * 缺失成 tell。app 是普通数据对象(isInstalled / InstallState / RunningState + 四个方法壳)。
 */
import { chromeHost } from './gates.js';

export default {
  name: 'chrome',
  applies: chromeHost,
  apply({ window, mask }) {
    const { adopt, native } = mask;
    // adopt:把自造对象顶端从 Node 异源 Object.prototype 重定向到 window.Object.prototype
    // (跨 realm 顶端 tell,根因见 protochain)。
    const chrome = adopt({});

    // 老式 native 函数壳:普通 function 保 .prototype,native(impl,'',0) 设 name=''/length=0/toString native。
    const legacyFn = (impl) => native(impl, '', 0);

    // 时序锚点:秒级 epoch 浮点(loadTimes 用),自洽锚定文档建时(timeOrigin)。
    const t0 = (window.performance && window.performance.timeOrigin
      ? window.performance.timeOrigin : Date.now()) / 1000;

    // loadTimes():页面加载时序壳(对照 sdenv;字段/类型对齐真机返回形态)。
    chrome.loadTimes = legacyFn(function () {
      return adopt({
        requestTime: t0, startLoadTime: t0, commitLoadTime: t0 + 0.04,
        finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
        navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
      });
    });
    // csi():startE/onloadT 为 epoch ms、pageT 为 ms、tran 为过渡类型号。
    chrome.csi = legacyFn(function () {
      const ms = Math.floor(t0 * 1000);
      return adopt({ startE: ms, onloadT: ms + 300, pageT: 1200.5, tran: 15 });
    });
    // app:数据对象(无 runtime)。方法壳走箭头 native(无 .prototype,常见 native 方法形态;此子对象未入 probe)。
    chrome.app = adopt({
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: native(() => null, 'getDetails', 0),
      getIsInstalled: native(() => false, 'getIsInstalled', 0),
      installState: native(() => 'disabled', 'installState', 0),
      runningState: native(() => 'cannot_run', 'runningState', 0),
    });

    window.chrome = chrome; // 定义序 = own 键序 [loadTimes, csi, app],对齐真机
  },
};
