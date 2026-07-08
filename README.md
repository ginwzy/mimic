# mimic

基于 **jsdom** 的浏览器环境伪装框架。用真实 DOM 作基座,通过 **Profile/traits** 声明式驱动,把环境改造成指定设备的 Chrome,面向 JS 逆向反检测(Akamai 等)。

## 设计

```
┌──────────────────────────────────────────────┐
│ entry    run / check / serve     命令与编程入口 │
├──────────────────────────────────────────────┤
│ realm    一个浏览器运行时实例(建→跑→毁)        │
├──────────┬──────────┬──────────┬──────────────┤
│ profile  │ patch    │ mask     │ trace        │
│ 指纹配置  │ Chrome特性│ 反检测原语│ 监控/检测    │
├──────────┴──────────┴──────────┴──────────────┤
│ base: jsdom    真实 DOM / 解析 / 事件(黑盒依赖) │
└──────────────────────────────────────────────┘
```

| 概念 | 含义 |
|---|---|
| **Realm** | 一套完整的浏览器全局世界 + 一次脚本执行 |
| **Profile** | 声明式指纹配置,一个 JSON = 一个身份;`extends` 继承结构、`traits` 声明特征 |
| **Patch** | 把 jsdom 改造成"真 Chrome"的特性单元,`applies(traits)` 决定何时生效 |
| **Mask** | 反检测原语(`fn`/`tag`/`iface`/`mixin`),收敛所有伪装逻辑 |
| **Trace** | 缺失 API 检测 + 访问监控(可选) |

## 用法

```bash
npm install

# 编程 API
node -e "import('./entry/index.js').then(async ({Realm}) => {
  const r = await Realm.create({ profile: 'chrome-mac' });
  console.log(r.run('navigator.userAgent').value);
})"

# 命令行
npm run mimic -- run   <script> --profile chrome-mac [--trace]
npm run mimic -- check <script>            # 缺失 API + 建议 patch
npm run mimic -- capture                   # 起采集服务,目标设备(含手机/WebView)访问后落盘 profile
npm run mimic -- profiles                  # 列出可用指纹

# 冒烟测试(含跨 realm 身份 + 平台差异验证)
npm run smoke
```

## 平台差异

环境差异分两类,各用一种机制:

- **值差异**(UA / 屏幕 / GPU)→ Profile 数据,经 `extends` 复用结构。
- **结构差异**(有无 `window.chrome` / 触摸形态)→ Patch + `traits` 门控。

`traits` 是真实采集的投影(非独立旋钮),`profile.validate()` 守住自洽。host 校验以**结构事实**(有无 `window.chrome` 键)为准:profile 带该键时,`host=chrome` 须有、`host=webview` 须无;不带时仅对 `host=chrome` 单向兜底(UA 不得含 `wv`)。它**不**强制 `host=webview` 必带 `wv`——以容纳改了 UA 的合法 WebView(如 via)。同一套 patch 由 traits 驱动出不同环境:

```
chrome-mac      host=chrome  → window.chrome 存在;touch 删桌面误带的 ontouch*
android-webview host=webview → window.chrome 不存在(chrome 跳过);touch 置 window.orientation
```

`realm.describe()` 可内省某环境由哪些 patch 组成 / 跳过。

## 设计纪律

1. 只有 `base/jsdom.js` 接触 jsdom —— 换引擎只改一处。
2. patch 只调 `mask.*`,不写裸伪装 —— 反检测正确性(含跨 realm 身份)收敛一层。
3. 身份段(canvas/webgl/audio/fonts)整段来自单次真实采集,不跨层拼装。
4. traits 由真机采集驱动,拿到新数据点前不投机扩展特征轴。

## 目录

```
base/    jsdom 封装
core/    realm / profile / pipeline
mask/    反检测原语
patch/   navigator / screen / viewport / timezone / chrome / touch / canvas / webgl / audio / clock
trace/   detector / monitor
entry/   index(API) / cli / server
capture/ 真机采集(collect 浏览器端 / derive 派生 traits / server 托管回传落盘)
harness/ 结构探针 / 真机基线 / mimic-vs-真机 diff gate
profiles/  _base/ + 各设备 profile;android-chrome/ 为真机身份池(运行时按 Profile.list() 挑一条轮换)
tools/   语料导入与验证等开发工具
reference/ legacy(旧实现归档) + sdenv/sdenv-extend(已 vendored 的第三方参考实现)
```

## License

本项目 MIT。`reference/sdenv` 与 `reference/sdenv-extend` 为 vendored 的第三方参考实现,各自保留其
原始许可证(`reference/sdenv` 为 BSD-3-Clause,见该目录 `LICENSE`),不受顶层 MIT 覆盖。
