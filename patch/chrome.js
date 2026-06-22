/**
 * patch/chrome —— 注入 window.chrome 对象(完整 Chrome 特有,WebView 无)。
 * 门控:仅 host=chrome 生效;WebView(host=webview)自动跳过 → window.chrome 不存在。
 * 对照 sdenv: browser/chrome/chrome.js
 * TODO: 补全 chrome.runtime / chrome.loadTimes / chrome.csi。
 */
export default {
  name: 'chrome',
  applies: (t) => t.host === 'chrome',
  apply({ window, mask }) {
    const chrome = { runtime: {} };
    mask.tag(chrome.runtime, 'Object');
    window.chrome = chrome;
  },
};
