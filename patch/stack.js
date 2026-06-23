/**
 * patch/stack —— 清洗 error.stack 的执行环境泄漏(剥离 Node 宿主帧)。
 *
 * 现状[实测]:目标脚本经 vm.runInContext(见 core/realm)执行后,error.stack 仍在栈底/栈中暴露宿主帧:
 *   同步:  at Script.runInContext (node:vm:149)        ← node: 形态(Node 内置模块)
 *           at run (file:///.../core/realm.js:..)        ← file:// 形态(mimic 的 ESM 模块)
 *   异步/事件回调:
 *           at Timeout.task [as _onTimeout] (/home/users/nate/.../node_modules/jsdom/.../Window.js:579)  ← 裸绝对路径形态(jsdom CommonJS)
 *           at callTheUserObjectsOperation (/home/.../jsdom/living/generated/EventListener.js:26)
 * 三种形态都泄漏:vm 执行路径、mimic 真实路径、jsdom 安装路径 + 内部文件名。
 * 真实浏览器里页面脚本由事件循环以独立 task 调度,C++ 宿主帧不出现在 JS stack —— 页面帧之间/栈底都不该有非页面帧。
 * vmp 常检测 stack 的格式/来源(是否含路径/node:、栈底/栈中是否有非页面帧)。
 *
 * 执行路径(core/realm:vm.runInContext + filename=页面URL)已消除"页面帧"侧的 "eval at run (file://...)" 泄漏;
 * 本 patch 处理"宿主帧"侧:在 window 内安装 Error.prepareStackTrace —— V8 在 .stack 首次格式化时调用它,
 * 传入结构化 CallSite[]。我们滤除所有"非页面来源"的帧,其余帧直接复用 CallSite.toString() —— 即 V8 原生 Chrome
 * 帧格式,自动覆盖 具名/匿名/构造器/eval/async 各形态,无需手拼、零格式偏差。装一次,后续所有 error 的 .stack 自动清洗。
 *
 * 判据用"页面来源白名单"而非枚举宿主形态:页面帧 fileName 必为 http(s)/data/blob/about 开头(我们传入的脚本 URL、
 * data:/blob: 脚本),或为空(page 内 eval/匿名/`new Promise (<anonymous>)`);其余(node:、file://、jsdom 裸绝对路径、
 * 未来任何新路径形态)一律判宿主帧。比"枚举 node:/file: 前缀"更鲁棒 —— 异步回调的 jsdom 裸路径帧正是前缀法漏掉的。
 *
 * 用 filter(而非遇宿主帧即截断):page 调用 jsdom 派发逻辑(addEventListener/setTimeout 回调,fileName 为裸路径)
 * 再回调 page 时,栈中会"夹"宿主帧 —— 真机里该位置是 C++ native 帧(不显示),故删除所有宿主帧、保留两端页面帧最贴真机。
 *
 * 已知残留(拆 follow-up):① 'prepareStackTrace' 成为 Error 的可见 own property(真机为 undefined 且非 own)是 tell;
 * ② 页面若替换 Error.prepareStackTrace,可拿到含宿主帧的原始 CallSite。本 patch 先把"字符串层 .stack"做干净(yvq.3 验证条件),
 * 过渡期至少把 prepareStackTrace 自身 native 化,避免 Error.prepareStackTrace.toString() 直接泄漏 mimic 源码。
 */
export default {
  name: 'stack',
  after: [],
  apply({ window, mask }) {
    // 页面来源:http(s)/data/blob/about 协议,或空 fileName(page 内 eval/匿名帧)。其余皆宿主帧。
    const isPageFrame = (file) => !file || /^(?:https?|data|blob|about):/.test(file);

    const prepareStackTrace = mask.fn(function prepareStackTrace(error, frames) {
      const name = (error && error.name) || 'Error';
      const message = error && error.message;
      const head = message ? `${name}: ${message}` : name;
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        let file;
        try {
          file = frame.getFileName();
        } catch {
          file = '';
        }
        if (!isPageFrame(file)) continue; // 宿主帧:对应真机的 native 帧,不显示
        lines.push(`    at ${frame.toString()}`); // V8 原生 Chrome 帧格式
      }
      return lines.length ? `${head}\n${lines.join('\n')}` : head;
    }, 'prepareStackTrace', 2);

    window.Error.prepareStackTrace = prepareStackTrace;
  },
};
