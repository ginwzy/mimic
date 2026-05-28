# JS 沙箱环境框架

一个功能完整的 JavaScript 沙箱执行框架，专为 JS 逆向工程设计。支持运行复杂混淆代码、指纹配置驱动的浏览器环境模拟、Canvas/WebGL/Audio 指纹生成、代理监控等功能。

## 核心特性

- **指纹配置系统** - 一个 JSON 文件控制所有浏览器指纹特征，一键切换设备身份
- **完整浏览器环境** - Navigator、Screen、Window、Location、DOM、Canvas、WebGL、Audio 全覆盖
- **高性能沙箱** - 基于 Node.js VM，7866 行混淆代码 18ms 执行完成
- **自动检测模式** - 自动报告脚本缺失的 API，给出加载建议
- **代理监控** - 完整的 Proxy 追踪，记录所有属性访问和方法调用
- **反检测** - webdriver=false、toString 保护、无 bot 特征泄露
- **Web 管理界面** - 在线执行代码、管理环境、查看日志
- **AI 辅助补环境** - 自动生成缺失 API 的补环境代码

## 系统要求

- Node.js >= 18.0.0
- npm
- Python 3.x（仅指纹采集功能需要，可选）

## 安装

```bash
git clone <repo-url>
cd js-sandbox-env-framework
npm install
```

## 快速开始

框架提供三种使用方式：命令行工具、Web 界面、编程 API。

### 命令行（推荐）

```bash
# 最简单的方式：直接运行脚本
node standalone-runner.js your-script.js

# 使用指纹配置运行（推荐，自动加载完整浏览器环境）
node standalone-runner.js --profile default your-script.js

# 不确定脚本需要什么？用检测模式先分析
node standalone-runner.js --detect your-script.js

# 直接执行一段代码
node standalone-runner.js --code "console.log(navigator.userAgent)"
```

### Web 界面

```bash
npm start
# 访问 http://localhost:3000
```

### 编程 API

```javascript
import { SimpleSandbox } from './server/sandbox/SimpleSandbox.js';
import fs from 'fs';

// 加载指纹配置
const profileData = JSON.parse(fs.readFileSync('profiles/default.json', 'utf-8'));

// 创建沙箱
const sandbox = new SimpleSandbox();
sandbox.init({ profile: profileData, timeout: 60000 });

// 注入环境模块（可以是文件路径、代码字符串或对象）
sandbox.injectEnvironment('env/dom/document.js');
sandbox.injectEnvironment('env/bom/navigator.js');

// 执行代码
const result = sandbox.execute('navigator.userAgent');
console.log(result);
// { success: true, result: 'Mozilla/5.0 ...', duration: 3, consoleOutput: [], ... }

// 执行文件
const fileResult = sandbox.executeFile('your-script.js');

// 重置沙箱（清空所有状态）
sandbox.reset();

// 销毁
sandbox.dispose();
```

---

## 命令行工具详解

### standalone-runner.js（主运行器）

这是最常用的入口，支持所有功能组合。

```bash
node standalone-runner.js [选项] <脚本文件>
```

#### 全部选项

| 选项 | 缩写 | 说明 | 默认值 |
|------|------|------|--------|
| `--profile <名称>` | | 加载指纹配置（从 `profiles/` 目录） | 无 |
| `--profile-file <路径>` | | 加载自定义指纹配置文件 | 无 |
| `--detect` | `-d` | 自动检测模式（报告缺失 API） | 关闭 |
| `--proxy` | `-p` | 启用代理监控（记录所有属性访问） | 关闭 |
| `--env <文件>` | | 加载额外环境文件（JSON 或 JS） | 无 |
| `--quiet` | `-q` | 静默模式（减少日志输出） | 关闭 |
| `--timeout <毫秒>` | | 超时时间 | 60000 |
| `--code <代码>` | | 直接执行代码字符串 | 无 |
| `--help` | `-h` | 显示帮助信息 | |

#### 使用示例

```bash
# 基础运行
node standalone-runner.js script.js

# 使用默认指纹配置（Chrome 120 + Win10 + NVIDIA RTX 3060）
node standalone-runner.js --profile default script.js

# 使用自定义指纹配置文件
node standalone-runner.js --profile-file ./my-device.json script.js

# 检测模式：分析脚本需要哪些 API
node standalone-runner.js --detect script.js

# 指纹配置 + 代理监控（深度调试）
node standalone-runner.js --profile default --proxy script.js

# 指纹配置 + 额外环境文件
node standalone-runner.js --profile default --env extra-env.js script.js

# 直接执行代码
node standalone-runner.js --code "console.log(navigator.userAgent)"

# 静默模式（只输出结果）
node standalone-runner.js --quiet --profile default script.js

# 设置超时时间为 10 秒
node standalone-runner.js --timeout 10000 script.js
```

#### 输出说明

运行后会输出以下信息：

```
🚀 启动沙箱环境... [Profile+Proxy]

✓ Profile 已加载: chrome-120-win10-nvidia
  加载环境模块...
  ✓ 环境模块加载完成

✓ 代理监控已加载
✓ 代理环境已加载

📜 执行脚本: script.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
执行结果:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Sandbox] ... (脚本的 console 输出)

📤 返回值:
"abc123..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 代理监控统计:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   执行时间: 18ms
   状态: ✅ 成功
   属性访问 (get): 1234 次
   属性设置 (set): 56 次
   函数调用 (apply): 78 次
   构造调用 (construct): 9 次
   总操作数: 1377 次
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### load-proxy-env.js（高级代理监控）

专注于 Proxy 深度监控，适合需要追踪所有属性访问链路的场景。

```bash
node load-proxy-env.js <script.js> [选项]

选项:
  --quiet              静默模式
  --profile <名称>      加载指纹配置
  --profile-file <路径> 加载自定义指纹配置文件

示例:
  node load-proxy-env.js a_bogus119.js
  node load-proxy-env.js test.js --profile default
  node load-proxy-env.js test.js --quiet
```

### view-logs.js（日志查看工具）

运行脚本并输出详细的执行日志，包括函数调用、对象创建等。

```bash
node view-logs.js <script.js>

示例:
  node view-logs.js a_bogus119.js
```

### npm scripts

```bash
npm start              # 启动 Web 服务 (http://localhost:3000)
npm run dev            # 开发模式（文件变更自动重启）
npm run test           # 运行测试
npm run run            # 等同于 node standalone-runner.js
npm run logs           # 等同于 node view-logs.js
npm run proxy          # 等同于 node load-proxy-env.js
npm run collect        # 运行指纹采集（需要 Python）
npm run collect:web    # 运行网站环境采集（需要 Python）
```

---

## 指纹配置系统 (Profile)

Profile 是本框架的核心能力。通过一个 JSON 配置文件，控制沙箱中所有浏览器可识别的特征值，实现设备身份的完整模拟。

### 工作原理

1. 加载 `--profile` 时，框架读取 JSON 配置到 `__profile__`
2. `ProfileManager` 初始化，将配置分发到各环境模块
3. 各模块（navigator、screen、canvas 等）从 profile 读取值并注入沙箱
4. 脚本运行时访问的所有浏览器 API 都返回 profile 中配置的值

### 使用方式

```bash
# 使用内置配置（Chrome 120 + Win10 + NVIDIA RTX 3060）
node standalone-runner.js --profile default your-script.js

# 使用自定义配置文件（任意路径）
node standalone-runner.js --profile-file ./my-device.json your-script.js
```

### 配置文件结构

配置文件存放在 `profiles/` 目录，完整结构如下：

```json
{
  "meta": {
    "name": "chrome-120-win10-nvidia",
    "description": "Chrome 120 on Windows 10 with NVIDIA GPU",
    "version": "1.0",
    "source": "manual"
  },
  "navigator": {
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
    "appCodeName": "Mozilla",
    "appName": "Netscape",
    "appVersion": "5.0 (Windows NT 10.0; Win64; x64) ...",
    "platform": "Win32",
    "product": "Gecko",
    "vendor": "Google Inc.",
    "language": "zh-CN",
    "languages": ["zh-CN", "zh", "en"],
    "hardwareConcurrency": 8,
    "deviceMemory": 8,
    "maxTouchPoints": 0,
    "webdriver": false,
    "cookieEnabled": true,
    "onLine": true,
    "connection": {
      "downlink": 10,
      "effectiveType": "4g",
      "rtt": 50,
      "saveData": false
    },
    "plugins": [
      { "name": "PDF Viewer", "description": "Portable Document Format", "filename": "internal-pdf-viewer" }
    ],
    "userAgentData": {
      "brands": [
        { "brand": "Chromium", "version": "120" },
        { "brand": "Google Chrome", "version": "120" }
      ],
      "mobile": false,
      "platform": "Windows"
    }
  },
  "screen": {
    "width": 1920,
    "height": 1080,
    "availWidth": 1920,
    "availHeight": 1040,
    "colorDepth": 24,
    "pixelDepth": 24,
    "orientation": { "angle": 0, "type": "landscape-primary" }
  },
  "window": {
    "innerWidth": 1920,
    "innerHeight": 969,
    "outerWidth": 1920,
    "outerHeight": 1080,
    "devicePixelRatio": 1
  },
  "canvas": {
    "toDataURL": "data:image/png;base64,<从真实浏览器复制的 base64>",
    "fingerprint": { "seed": 48291637, "noise": 0.01 }
  },
  "webgl": {
    "vendor": "WebKit",
    "renderer": "WebKit WebGL",
    "unmaskedVendor": "Google Inc. (NVIDIA)",
    "unmaskedRenderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 ...)",
    "extensions": ["ANGLE_instanced_arrays", "EXT_blend_minmax", "..."],
    "parameters": {
      "37445": "Google Inc. (NVIDIA)",
      "37446": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 ...)",
      "3379": 16384
    }
  },
  "audio": {
    "sampleRate": 44100,
    "maxChannelCount": 2,
    "baseLatency": 0.005333,
    "fingerprint": { "sum": 124.04347527516074, "seed": 73920156 }
  },
  "location": {
    "href": "https://www.example.com/",
    "protocol": "https:",
    "host": "www.example.com",
    "hostname": "www.example.com",
    "pathname": "/",
    "origin": "https://www.example.com"
  },
  "timezone": {
    "offset": -480,
    "timezone": "Asia/Shanghai"
  },
  "fonts": ["Arial", "Microsoft YaHei", "SimHei", "SimSun", "Times New Roman"]
}
```

### 自定义指纹速查表

| 想改什么 | 改哪里 | 示例值 |
|---------|--------|--------|
| 浏览器 UA | `navigator.userAgent` | `Mozilla/5.0 ... Chrome/120.0.0.0` |
| 操作系统 | `navigator.platform` + UA | `Win32` / `MacIntel` / `Linux x86_64` |
| 屏幕分辨率 | `screen.width` / `screen.height` | `1920` / `1080` |
| GPU 型号 | `webgl.parameters["37446"]` | `ANGLE (NVIDIA, ...)` |
| Canvas 指纹 | `canvas.toDataURL` | 从真实浏览器复制 base64 |
| 地理位置 | `location.href` / `location.hostname` | `https://target.com/` |
| 时区 | `timezone.offset` / `timezone.timezone` | `-480` / `Asia/Shanghai` |
| CPU 核心数 | `navigator.hardwareConcurrency` | `8` |
| 内存大小 | `navigator.deviceMemory` | `8` |
| 语言 | `navigator.language` | `zh-CN` / `en-US` |

### 运行时动态修改

在脚本执行过程中，可以通过 `ProfileManager` 动态修改指纹值：

```javascript
// 获取当前值
window.__ProfileManager__.get('navigator.userAgent');

// 修改单个值
window.__ProfileManager__.set('navigator.userAgent', 'Mozilla/5.0 ...');

// 批量合并
window.__ProfileManager__.merge('screen', { width: 2560, height: 1440 });

// 获取完整配置
window.__ProfileManager__.getAll();
```

### 如何从真实浏览器采集指纹

**方法一：手动采集**

在目标浏览器控制台执行：

```javascript
// 采集 Canvas 指纹
var c = document.createElement('canvas');
c.width = 200; c.height = 50;
var ctx = c.getContext('2d');
ctx.fillText('test', 10, 10);
console.log(c.toDataURL());

// 采集 WebGL GPU 信息
var c = document.createElement('canvas');
var gl = c.getContext('webgl');
var ext = gl.getExtension('WEBGL_debug_renderer_info');
console.log('Vendor:', gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
console.log('Renderer:', gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));

// 采集 Audio 指纹
var ctx = new OfflineAudioContext(1, 44100, 44100);
var osc = ctx.createOscillator();
osc.connect(ctx.destination);
osc.start(0);
ctx.startRendering().then(buf => {
  var data = buf.getChannelData(0);
  var sum = data.reduce((a, b) => a + Math.abs(b), 0);
  console.log('Audio sum:', sum);
});
```

**方法二：使用采集脚本（自动化）**

```bash
# 安装 Python 依赖
pip install -r collector/requirements.txt

# 采集指纹（使用 Selenium 打开浏览器自动采集）
npm run collect
# 或
python collector/fingerprint-collector.py

# 采集目标网站的环境信息
npm run collect:web
# 或
python collector/website-env-collector.py
```

采集结果会保存为 JSON 文件，可直接作为 profile 使用。

---

## 自动检测模式

不确定脚本需要哪些 API？用 `--detect` 自动分析：

```bash
node standalone-runner.js --detect your-script.js
```

检测模式会：
1. 在最小环境下运行脚本
2. 捕获所有 `undefined` 属性访问
3. 记录运行时错误
4. 生成缺失 API 报告和加载建议

输出示例：

```
🔍 自动检测报告:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   执行时间: 5ms | 状态: ❌ 失败
   缺失 API: 3 个
   运行时错误: 1 个

   ⚠️  关键缺失:
      - document.createElement
      - navigator.userAgent

   📋 缺失属性 (前20个):
      - window.document.createElement
      - window.navigator.userAgent
      - window.navigator.platform

   💡 建议加载:
      - env/dom/document.js (DOM 操作)
      - env/bom/navigator.js (Navigator 属性)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

典型工作流：

```bash
# 第一步：检测缺什么
node standalone-runner.js --detect script.js

# 第二步：根据建议，使用 profile 加载完整环境
node standalone-runner.js --profile default script.js

# 或者只加载需要的模块
node standalone-runner.js --env env/bom/navigator.js script.js
```

---

## 代理监控

代理监控使用 ES6 Proxy 拦截所有对象操作，适合深度调试和分析脚本行为。

### 启用方式

```bash
# 方式一：standalone-runner 加 --proxy 参数
node standalone-runner.js --profile default --proxy script.js

# 方式二：使用专用的代理监控运行器
node load-proxy-env.js script.js
node load-proxy-env.js --profile default script.js
```

### 监控内容

| 操作类型 | 说明 | 示例 |
|---------|------|------|
| get | 属性读取 | `navigator.userAgent` |
| set | 属性赋值 | `window.x = 1` |
| apply | 函数调用 | `document.createElement('div')` |
| construct | 构造调用 | `new XMLHttpRequest()` |

### 输出示例

```
📊 代理监控统计:
   执行时间: 18ms
   状态: ✅ 成功
   属性访问 (get): 1234 次
   属性设置 (set): 56 次
   函数调用 (apply): 78 次
   构造调用 (construct): 9 次
   总操作数: 1377 次
```

---

## Web 界面与服务端 API

### 启动服务

```bash
# 生产模式
npm start
# 或指定端口
PORT=8080 npm start

# 开发模式（文件变更自动重启）
npm run dev
```

启动后访问 `http://localhost:3000`，Web 界面支持：
- 在线编辑和执行 JS 代码
- 上传脚本文件执行
- 查看执行日志和 undefined 列表
- 管理环境文件
- AI 辅助补环境
- 快照保存和恢复

### REST API

所有 API 返回 JSON 格式，基础路径为 `http://localhost:3000/api`。

#### 沙箱执行

```bash
# 执行代码
curl -X POST http://localhost:3000/api/sandbox/run \
  -H "Content-Type: application/json" \
  -d '{"code": "navigator.userAgent", "timeout": 5000}'

# 响应
{
  "success": true,
  "result": "Mozilla/5.0 ...",
  "duration": 3,
  "consoleOutput": [],
  "accessLogs": [],
  "callLogs": [],
  "undefinedPaths": []
}

# 注入环境代码
curl -X POST http://localhost:3000/api/sandbox/inject-env \
  -H "Content-Type: application/json" \
  -d '{"code": "window.myVar = 123"}'

# 加载环境文件
curl -X POST http://localhost:3000/api/sandbox/load-env \
  -H "Content-Type: application/json" \
  -d '{"file": "bom/navigator.js"}'

# 加载所有环境文件
curl -X POST http://localhost:3000/api/sandbox/load-env \
  -H "Content-Type: application/json" \
  -d '{"all": true}'

# 重置沙箱
curl -X POST http://localhost:3000/api/sandbox/reset

# 获取沙箱状态
curl http://localhost:3000/api/sandbox/status

# 获取 undefined 列表
curl http://localhost:3000/api/sandbox/undefined

# 获取日志
curl http://localhost:3000/api/sandbox/logs
curl "http://localhost:3000/api/sandbox/logs?type=access&limit=50"

# 清除日志
curl -X POST http://localhost:3000/api/sandbox/logs/clear

# 执行文件
curl -X POST http://localhost:3000/api/sandbox/run-file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/script.js"}'
```

#### 环境文件管理

```bash
# 获取环境文件目录结构
curl http://localhost:3000/api/env/list

# 读取指定环境文件
curl "http://localhost:3000/api/env/file?path=bom/navigator.js"

# 写入/更新环境文件
curl -X POST http://localhost:3000/api/env/file \
  -H "Content-Type: application/json" \
  -d '{"path": "custom/my-env.js", "content": "window.x = 1;"}'

# 删除 AI 生成的文件
curl -X DELETE "http://localhost:3000/api/env/file?path=ai-generated/xxx.js"
```

#### AI 辅助补环境

```bash
# 获取 AI 配置
curl http://localhost:3000/api/ai/config

# 配置 AI 平台（支持 OpenAI 兼容接口）
curl -X POST http://localhost:3000/api/ai/config \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-xxx", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4"}'

# 生成补环境代码
curl -X POST http://localhost:3000/api/ai/complete \
  -H "Content-Type: application/json" \
  -d '{"undefinedPath": "document.createElement", "context": "需要创建 canvas 元素"}'

# 应用 AI 生成的代码
curl -X POST http://localhost:3000/api/ai/apply \
  -H "Content-Type: application/json" \
  -d '{"code": "...", "filename": "document_createElement.js"}'

# 获取 AI 历史记录
curl http://localhost:3000/api/ai/history
```

#### 快照管理

```bash
# 保存当前沙箱状态为快照
curl -X POST http://localhost:3000/api/snapshot/save \
  -H "Content-Type: application/json" \
  -d '{"name": "after-init"}'

# 加载快照
curl -X POST http://localhost:3000/api/snapshot/load \
  -H "Content-Type: application/json" \
  -d '{"name": "after-init"}'

# 列出所有快照
curl http://localhost:3000/api/snapshot/list

# 删除快照
curl -X DELETE http://localhost:3000/api/snapshot/after-init
```

#### Mock 规则

```bash
# 获取所有 Mock 规则
curl http://localhost:3000/api/mock/rules

# 添加 Mock 规则
curl -X POST http://localhost:3000/api/mock/rules \
  -H "Content-Type: application/json" \
  -d '{"path": "navigator.userAgent", "value": "CustomUA/1.0"}'

# 获取预设模板
curl http://localhost:3000/api/mock/presets

# 应用预设模板
curl -X POST http://localhost:3000/api/mock/presets/chrome-mobile/apply

# 生成注入代码
curl http://localhost:3000/api/mock/inject-code
```

#### 健康检查

```bash
curl http://localhost:3000/api/health
# {"status":"ok","timestamp":"2026-05-28T...","uptime":123.456}

# API 文档（列出所有端点）
curl http://localhost:3000/api
```

---

## 环境模块

框架提供完整的浏览器环境模拟，所有模块位于 `env/` 目录。使用 `--profile` 时会自动加载所有模块。

### 模块列表

| 分类 | 模块 | 路径 | 覆盖内容 |
|------|------|------|---------|
| 核心 | ProfileManager | `env/core/ProfileManager.js` | 指纹配置管理 |
| 核心 | AutoDetector | `env/core/AutoDetector.js` | 自动检测缺失 API |
| 核心 | ProxyMonitor | `env/core/ProxyMonitor.js` | Proxy 监控统计 |
| 核心 | ProxyEnv | `env/core/ProxyEnv.js` | Proxy 环境包装 |
| 核心 | EnvMonitor | `env/core/EnvMonitor.js` | 环境监控 |
| 核心 | MonitorSystem | `env/core/MonitorSystem.js` | 监控系统 |
| BOM | Navigator | `env/bom/navigator.js` | UA、platform、plugins、connection、webdriver |
| BOM | Screen | `env/bom/screen.js` | 分辨率、色深、可用区域、orientation |
| BOM | Window | `env/bom/window.js` | innerWidth/Height、devicePixelRatio |
| BOM | Location | `env/bom/location.js` | href、protocol、hostname、pathname |
| BOM | History | `env/bom/history.js` | pushState、replaceState、back/forward |
| BOM | Storage | `env/bom/storage.js` | localStorage、sessionStorage |
| BOM | Crypto | `env/bom/crypto.js` | crypto.getRandomValues、subtle |
| BOM | Performance | `env/bom/performance.js` | performance.now、timing、navigation |
| BOM | Console | `env/bom/console.js` | console 方法 |
| BOM | Observers | `env/bom/observers.js` | MutationObserver、IntersectionObserver |
| DOM | Document | `env/dom/document.js` | createElement、querySelector、cookie |
| DOM | Elements | `env/dom/elements.js` | Canvas、WebGL、所有 HTML 元素（59种） |
| DOM | Event | `env/dom/event.js` | Event、addEventListener、dispatchEvent |
| WebAPI | Audio | `env/webapi/audio.js` | AudioContext、OfflineAudioContext |
| WebAPI | Fetch | `env/webapi/fetch.js` | fetch、Request、Response |
| WebAPI | XHR | `env/webapi/xhr.js` | XMLHttpRequest |
| WebAPI | URL | `env/webapi/url.js` | URL、URLSearchParams |
| WebAPI | Blob | `env/webapi/blob.js` | Blob、File |
| WebAPI | Network | `env/webapi/network.js` | NetworkInformation |
| 编码 | TextEncoder | `env/encoding/textencoder.js` | TextEncoder、TextDecoder |
| 编码 | atob/btoa | `env/encoding/atob.js` | Base64 编解码 |
| 定时器 | Timeout | `env/timer/timeout.js` | setTimeout、setInterval |

### 手动加载模块

不使用 `--profile` 时，可以通过 `--env` 手动加载需要的模块：

```bash
# 加载单个模块
node standalone-runner.js --env env/bom/navigator.js script.js

# 加载多个模块（多次使用 --env 或写一个加载脚本）
```

或在编程 API 中：

```javascript
const sandbox = new SimpleSandbox();
sandbox.init();
sandbox.injectEnvironment('env/bom/navigator.js');
sandbox.injectEnvironment('env/dom/document.js');
sandbox.injectEnvironment('env/dom/elements.js');
sandbox.execute(code);
```

### 指纹 API 详情

**Canvas 指纹**
- `toDataURL()` 返回 profile 中配置的真实 base64 数据
- `getImageData()` 基于 seed 生成确定性像素数据
- `measureText()` 返回合理的文字测量值
- 支持 2D 绑图操作：fillRect、strokeRect、fillText、arc 等

**WebGL 指纹**
- `getParameter()` 从 profile 查表返回（GPU 型号、最大纹理等）
- `getSupportedExtensions()` 返回配置的扩展列表
- `getExtension('WEBGL_debug_renderer_info')` 返回正确的常量对象
- 支持 WebGL2 上下文

**Audio 指纹**
- `OfflineAudioContext.startRendering()` 基于 seed 生成确定性音频数据
- 完整的节点连接链：Oscillator → DynamicsCompressor → Destination
- `getChannelData()` 返回可计算 hash 的 Float32Array
- 支持 AudioContext 和 OfflineAudioContext

---

## 项目结构

```
js-sandbox-env-framework/
├── standalone-runner.js          # 主运行器（推荐入口）
├── load-proxy-env.js             # 高级代理监控运行器
├── view-logs.js                  # 日志查看工具
├── package.json                  # 项目配置
├── profiles/
│   └── default.json              # 默认指纹配置（Chrome 120 + Win10 + RTX 3060）
├── env/
│   ├── core/
│   │   ├── ProfileManager.js     # 指纹配置管理器
│   │   ├── AutoDetector.js       # 自动检测器
│   │   ├── ProxyMonitor.js       # 代理监控
│   │   ├── ProxyEnv.js           # 代理环境
│   │   ├── EnvMonitor.js         # 环境监控
│   │   └── MonitorSystem.js      # 监控系统
│   ├── bom/
│   │   ├── navigator.js          # Navigator 环境
│   │   ├── screen.js             # Screen 环境
│   │   ├── window.js             # Window 属性
│   │   ├── location.js           # Location 环境
│   │   ├── history.js            # History API
│   │   ├── storage.js            # Storage 环境
│   │   ├── crypto.js             # Crypto API
│   │   ├── performance.js        # Performance API
│   │   ├── console.js            # Console
│   │   └── observers.js          # Observer API
│   ├── dom/
│   │   ├── document.js           # Document 环境
│   │   ├── elements.js           # HTML 元素 + Canvas/WebGL
│   │   └── event.js              # Event 系统
│   ├── webapi/
│   │   ├── audio.js              # Web Audio API
│   │   ├── fetch.js              # Fetch API
│   │   ├── xhr.js                # XMLHttpRequest
│   │   ├── url.js                # URL API
│   │   ├── blob.js               # Blob/File API
│   │   └── network.js            # Network Information
│   ├── encoding/
│   │   ├── textencoder.js        # TextEncoder/TextDecoder
│   │   └── atob.js               # Base64
│   ├── timer/
│   │   └── timeout.js            # 定时器
│   └── ai-generated/             # AI 自动生成的补环境代码
├── server/
│   ├── index.js                  # Web 服务入口
│   ├── sandbox/
│   │   ├── SimpleSandbox.js      # 沙箱核心
│   │   ├── SandboxManager.js     # 沙箱管理器
│   │   ├── DeepProxy.js          # 深度代理
│   │   └── ProxyLogger.js        # 代理日志
│   ├── routes/
│   │   ├── sandbox.js            # 沙箱 API 路由
│   │   ├── env.js                # 环境文件路由
│   │   ├── ai.js                 # AI 路由
│   │   ├── snapshot.js           # 快照路由
│   │   ├── log.js                # 日志路由
│   │   └── mock.js               # Mock 路由
│   └── ai/
│       ├── AIProvider.js         # AI 提供者
│       └── index.js              # AI 模块入口
├── web/
│   ├── index.html                # 前端页面
│   ├── css/style.css             # 样式
│   └── js/
│       ├── app.js                # 前端逻辑
│       └── api.js                # API 调用封装
├── collector/
│   ├── fingerprint-collector.py  # 指纹采集脚本
│   ├── website-env-collector.py  # 网站环境采集
│   ├── collect.py                # 通用采集
│   └── requirements.txt          # Python 依赖
├── test-profile.js               # Profile 系统测试（46项）
└── test-fingerprint.js           # 指纹检测模拟测试
```

---

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

---

## 典型工作流

### 场景一：运行一个未知的混淆脚本

```bash
# 1. 先用检测模式看看需要什么
node standalone-runner.js --detect unknown-script.js

# 2. 根据报告，加载完整环境运行
node standalone-runner.js --profile default unknown-script.js

# 3. 如果还有问题，开启代理监控深度调试
node standalone-runner.js --profile default --proxy unknown-script.js
```

### 场景二：模拟特定设备

```bash
# 1. 复制 profiles/default.json 为新文件
cp profiles/default.json profiles/iphone-15.json

# 2. 编辑配置，修改为 iPhone 15 的参数
#    - navigator.userAgent: iPhone UA
#    - navigator.platform: "iPhone"
#    - screen: 393x852
#    - navigator.maxTouchPoints: 5
#    等等

# 3. 使用新配置运行
node standalone-runner.js --profile iphone-15 script.js
```

### 场景三：使用 Web 界面调试

```bash
# 1. 启动服务
npm start

# 2. 打开浏览器访问 http://localhost:3000

# 3. 在界面中：
#    - 粘贴或上传脚本
#    - 选择环境模块
#    - 点击执行
#    - 查看结果和日志
#    - 使用 AI 补环境功能自动修复缺失 API
```

### 场景四：编程集成

```javascript
import { SimpleSandbox } from './server/sandbox/SimpleSandbox.js';
import fs from 'fs';

// 批量测试不同指纹配置
const profiles = ['default', 'iphone-15', 'android-pixel'];
const script = fs.readFileSync('target-script.js', 'utf-8');

for (const name of profiles) {
  const profile = JSON.parse(
    fs.readFileSync(`profiles/${name}.json`, 'utf-8')
  );
  
  const sandbox = new SimpleSandbox();
  sandbox.init({ profile });
  
  // 加载环境
  sandbox.injectEnvironment('env/dom/document.js');
  sandbox.injectEnvironment('env/bom/navigator.js');
  sandbox.injectEnvironment('env/dom/elements.js');
  sandbox.injectEnvironment('env/webapi/audio.js');
  
  const result = sandbox.execute(script);
  console.log(`[${name}] ${result.success ? '成功' : '失败'}: ${result.result}`);
  
  sandbox.dispose();
}
```

---

## 常见问题

**Q: 脚本报错缺少某个 API 怎么办？**

1. 先用 `--detect` 模式查看缺什么
2. 如果是已有模块覆盖的 API，加 `--profile default` 自动加载
3. 如果是未覆盖的 API，在 `env/` 目录下补充对应模块
4. 也可以使用 Web 界面的 AI 补环境功能自动生成

**Q: 不用 profile 能跑吗？**

可以。不加 `--profile` 参数时，框架只提供最基础的环境（console、setTimeout、atob/btoa、XMLHttpRequest），向后兼容。

**Q: 如何确保指纹不被检测？**

1. 使用从真实浏览器采集的 Canvas/WebGL/Audio 数据
2. 确保 `navigator.webdriver` 为 `false`
3. 确保所有 API 的 `toString()` 返回 `[native code]`
4. 使用 `test-fingerprint.js` 验证指纹一致性

**Q: 执行超时怎么办？**

默认超时 60 秒，可通过 `--timeout` 调整：

```bash
node standalone-runner.js --timeout 120000 heavy-script.js
```

**Q: 如何添加新的环境模块？**

在 `env/` 对应目录下创建 JS 文件，文件中直接操作全局对象即可：

```javascript
// env/webapi/my-api.js
window.MyAPI = {
  doSomething() {
    return 'result';
  }
};
```

然后通过 `--env` 加载或添加到 standalone-runner.js 的自动加载列表中。

**Q: Web 服务的端口如何修改？**

```bash
PORT=8080 npm start
```

**Q: AI 补环境如何配置？**

在 Web 界面中配置 AI 平台信息（API Key、Base URL、Model），或通过 API：

```bash
curl -X POST http://localhost:3000/api/ai/config \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "sk-xxx", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4"}'
```

---

## License

MIT License

---

**版本**: v3.0.0
**更新**: 2026-05-28
