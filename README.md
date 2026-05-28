# JS 沙箱环境框架

一个功能完整的 JavaScript 沙箱执行框架，专为 JS 逆向工程设计。支持运行复杂混淆代码、指纹配置驱动的浏览器环境模拟、Canvas/WebGL/Audio 指纹生成、代理监控等功能。

## 核心特性

- **指纹配置系统** - 一个 JSON 文件控制所有浏览器指纹特征，一键切换设备身份
- **完整浏览器环境** - Navigator、Screen、Window、Location、DOM、Canvas、WebGL、Audio 全覆盖
- **高性能沙箱** - 基于 Node.js VM，7866 行混淆代码 18ms 执行完成
- **自动检测模式** - 自动报告脚本缺失的 API，给出加载建议
- **代理监控** - 完整的 Proxy 追踪，记录所有属性访问和方法调用
- **反检测** - webdriver=false、toString 保护、无 bot 特征泄露

## 快速开始

```bash
# 安装依赖
npm install

# 最简单的方式：直接运行
node standalone-runner.js your-script.js

# 使用指纹配置运行（推荐）
node standalone-runner.js --profile default your-script.js

# 不确定脚本需要什么？用检测模式
node standalone-runner.js --detect your-script.js
```

## 指纹配置系统 (Profile)

Profile 是本框架的核心能力。通过一个 JSON 配置文件，控制沙箱中所有浏览器可识别的特征值。

### 使用方式

```bash
# 使用内置配置（Chrome 120 + Win10 + NVIDIA RTX 3060）
node standalone-runner.js --profile default your-script.js

# 使用自定义配置文件
node standalone-runner.js --profile-file ./my-device.json your-script.js
```

### 配置文件结构

配置文件存放在 `profiles/` 目录，格式如下：

```json
{
  "meta": { "name": "chrome-120-win10-nvidia", "description": "Chrome 120 Windows 10" },
  "navigator": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
    "platform": "Win32",
    "language": "zh-CN",
    "hardwareConcurrency": 8,
    "deviceMemory": 8,
    "webdriver": false
  },
  "screen": { "width": 1920, "height": 1080, "colorDepth": 24 },
  "window": { "innerWidth": 1920, "innerHeight": 969, "devicePixelRatio": 1 },
  "canvas": {
    "toDataURL": "data:image/png;base64,<从真实浏览器复制>",
    "fingerprint": { "seed": 12345 }
  },
  "webgl": {
    "parameters": { "37446": "ANGLE (NVIDIA, ...)", "37445": "Google Inc. (NVIDIA)", "3379": 16384 },
    "extensions": ["WEBGL_debug_renderer_info", "..."]
  },
  "audio": { "sampleRate": 44100, "fingerprint": { "seed": 67890 } },
  "location": { "href": "https://www.example.com/", "protocol": "https:" }
}
```

### 如何自定义指纹

| 想改什么 | 改哪里 |
|---------|--------|
| 浏览器 UA | `navigator.userAgent` |
| 操作系统 | `navigator.platform` + UA |
| 屏幕分辨率 | `screen.width` / `screen.height` |
| GPU 型号 | `webgl.parameters["37446"]` |
| Canvas 指纹 | `canvas.toDataURL`（从真实浏览器复制） |
| 地理位置 | `location.href` / `location.hostname` |
| 时区 | `timezone.offset` / `timezone.timezone` |

### 运行时动态修改

```javascript
// 在脚本中动态修改指纹
window.__ProfileManager__.set('navigator.userAgent', 'Mozilla/5.0 ...');
window.__ProfileManager__.merge('screen', { width: 2560, height: 1440 });
```

## 自动检测模式

不确定脚本需要哪些 API？用 `--detect` 自动分析：

```bash
node standalone-runner.js --detect your-script.js
```

输出示例：
```
🔍 自动检测报告:
   缺失 API: 3 个
   运行时错误: 1 个

   ⚠️  关键缺失:
      - document.createElement
      - navigator.userAgent

   💡 建议加载:
      - env/dom/document.js (DOM 操作)
      - env/bom/navigator.js (Navigator 属性)
```

## 命令行参数

```bash
node standalone-runner.js [选项] <脚本文件>

选项:
  --profile <名称>        加载指纹配置（从 profiles/ 目录）
  --profile-file <路径>   加载自定义指纹配置文件
  --detect, -d           自动检测模式（报告缺失 API）
  --proxy, -p            启用代理监控（记录所有属性访问）
  --env <文件>            加载环境文件（JSON 或 JS）
  --quiet, -q            静默模式
  --timeout <毫秒>        超时时间（默认 60000ms）
  --code <代码>           直接执行代码字符串
  --help, -h             帮助信息
```

### 组合使用

```bash
# 指纹配置 + 代理监控
node standalone-runner.js --profile default --proxy script.js

# 指纹配置 + 额外环境文件
node standalone-runner.js --profile default --env extra-env.js script.js

# 检测模式（不加载完整环境，看脚本需要什么）
node standalone-runner.js --detect script.js
```

## 环境模块

框架提供完整的浏览器环境模拟：

| 模块 | 路径 | 覆盖内容 |
|------|------|---------|
| Navigator | `env/bom/navigator.js` | UA、platform、plugins、connection、webdriver |
| Screen | `env/bom/screen.js` | 分辨率、色深、可用区域 |
| Window | `env/bom/window.js` | innerWidth/Height、devicePixelRatio |
| Location | `env/bom/location.js` | href、protocol、hostname、pathname |
| Document | `env/dom/document.js` | createElement、querySelector、cookie |
| Elements | `env/dom/elements.js` | Canvas、WebGL、所有 HTML 元素（59种） |
| Audio | `env/webapi/audio.js` | AudioContext、OfflineAudioContext、所有节点类型 |
| Storage | `env/bom/storage.js` | localStorage、sessionStorage |
| Crypto | `env/bom/crypto.js` | crypto.getRandomValues、subtle |
| Performance | `env/bom/performance.js` | performance.now、timing |
| History | `env/bom/history.js` | pushState、replaceState |

### 指纹 API 详情

**Canvas 指纹**
- `toDataURL()` 返回 profile 中配置的真实 base64 数据
- `getImageData()` 基于 seed 生成确定性像素数据
- `measureText()` 返回合理的文字测量值

**WebGL 指纹**
- `getParameter()` 从 profile 查表返回（GPU 型号、最大纹理等）
- `getSupportedExtensions()` 返回配置的扩展列表
- `getExtension('WEBGL_debug_renderer_info')` 返回正确的常量对象

**Audio 指纹**
- `OfflineAudioContext.startRendering()` 基于 seed 生成确定性音频数据
- 完整的节点连接链：Oscillator → DynamicsCompressor → Destination
- `getChannelData()` 返回可计算 hash 的 Float32Array

## 其他运行方式

### 高级代理监控

```bash
node load-proxy-env.js script.js
node load-proxy-env.js --profile default script.js
```

完整的 Proxy 监控，包含 toString 保护，适合深度调试。

### Web 界面

```bash
npm start
# 访问 http://localhost:3000
```

支持在线执行、文件上传、日志查看、环境搜索。

### 服务端 API

```javascript
import { SimpleSandbox } from './server/sandbox/SimpleSandbox.js';

const sandbox = new SimpleSandbox();
sandbox.init({ profile: profileData });
sandbox.injectEnvironment('env/dom/document.js');
const result = sandbox.execute(code);
```

## 项目结构

```
├── standalone-runner.js          # 主运行器（推荐入口）
├── load-proxy-env.js             # 高级代理监控运行器
├── profiles/
│   └── default.json              # 默认指纹配置（Chrome 120 + Win10 + RTX 3060）
├── env/
│   ├── core/
│   │   ├── ProfileManager.js     # 指纹配置管理器
│   │   ├── AutoDetector.js       # 自动检测器
│   │   ├── ProxyMonitor.js       # 代理监控
│   │   └── ProxyEnv.js           # 代理环境
│   ├── bom/
│   │   ├── navigator.js          # Navigator 环境
│   │   ├── screen.js             # Screen 环境
│   │   ├── window.js             # Window 属性
│   │   ├── location.js           # Location 环境
│   │   ├── storage.js            # Storage 环境
│   │   ├── crypto.js             # Crypto API
│   │   ├── performance.js        # Performance API
│   │   └── history.js            # History API
│   ├── dom/
│   │   ├── document.js           # Document 环境
│   │   ├── elements.js           # HTML 元素 + Canvas/WebGL
│   │   └── event.js              # Event 系统
│   └── webapi/
│       └── audio.js              # Web Audio API
├── server/
│   ├── index.js                  # Web 服务入口
│   └── sandbox/
│       └── SimpleSandbox.js      # 沙箱核心
├── collector/
│   ├── fingerprint-collector.py  # 指纹采集
│   └── website-env-collector.py  # 网站环境采集
├── test-profile.js               # Profile 系统测试（46项）
└── test-fingerprint.js           # 指纹检测模拟测试
```

## 测试验证

```bash
# 运行 Profile 系统测试（46 项全部通过）
node standalone-runner.js --profile default test-profile.js

# 运行指纹检测模拟（模拟真实网站检测逻辑）
node standalone-runner.js --profile default test-fingerprint.js

# 兼容性测试（混淆代码无 profile 也能跑）
node standalone-runner.js a_bogus119.js
```

| 测试项 | 结果 |
|--------|------|
| Profile 系统 46 项测试 | 全部通过 |
| Canvas 指纹（绘制+toDataURL+hash） | 正常出值 |
| WebGL 指纹（GPU 型号+扩展+参数） | 正常出值 |
| Audio 指纹（OfflineAudioContext+渲染） | 正常出值 |
| Bot 检测（webdriver/phantom/selenium） | 全部 false |
| 混淆代码兼容性（a_bogus119.js） | 18ms 通过 |

## 常见问题

**Q: 如何从真实浏览器获取 Canvas 指纹值？**

在浏览器控制台执行：
```javascript
var c = document.createElement('canvas');
c.width = 200; c.height = 50;
var ctx = c.getContext('2d');
ctx.fillText('test', 10, 10);
console.log(c.toDataURL());
```
将输出的 base64 字符串粘贴到 `profiles/default.json` 的 `canvas.toDataURL` 字段。

**Q: 如何获取 WebGL GPU 信息？**

在浏览器控制台执行：
```javascript
var c = document.createElement('canvas');
var gl = c.getContext('webgl');
var ext = gl.getExtension('WEBGL_debug_renderer_info');
console.log(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
```

**Q: 脚本报错缺少某个 API 怎么办？**

1. 先用 `--detect` 模式查看缺什么
2. 如果是已有模块覆盖的 API，加 `--profile default` 自动加载
3. 如果是未覆盖的 API，在 `env/` 目录下补充对应模块

**Q: 不用 profile 能跑吗？**

可以。不加 `--profile` 参数时，框架行为与之前完全一致，向后兼容。

## License

MIT License

---

**版本**: v3.0.0
**更新**: 2026-05-28
