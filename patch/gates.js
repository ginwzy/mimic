/**
 * patch/gates —— 门控谓词(指纹**一致性约束**,非纯代码组织)。
 * host(chrome-vs-webview)与 formFactor(mobile-vs-desktop)是两条独立轴:用命名谓词保住轴语义 ——
 * 单字符串会抹掉"这是 host 差还是平台差"的区分、且堵死未来"chrome 且 desktop"这类合取。真机基线决定
 * 每个特性属哪条轴;门控保证不出现"WebView 的 UA + Chrome 的能力面"这类不可能组合(被 antibot 判伪)。
 * globals/navigator/touch 等共享此一份定义,免一致性约束被各 patch 复制后漂移。
 */
export const chromeHost = (t) => t.host === 'chrome';        // Chrome-vs-WebView 特性差(WebView 缺的 secure-context Chrome 专属)
export const mobileOnly = (t) => t.formFactor === 'mobile';
export const desktopOnly = (t) => t.formFactor === 'desktop';
export const macosChrome = (t) => chromeHost(t) && t.platform === 'macos';
