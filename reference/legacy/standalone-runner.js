#!/usr/bin/env node
/**
 * 独立的沙箱脚本运行器
 * 可以直接在命令行中使用
 *
 * 用法:
 *   node standalone-runner.js script.js
 *   node standalone-runner.js --profile default script.js
 *   node standalone-runner.js --detect script.js
 *   node standalone-runner.js --code "console.log('Hello')"
 *   node standalone-runner.js --env env.json script.js
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析命令行参数
const args = process.argv.slice(2);
let scriptFile = null;
let codeString = null;
let envFile = null;
let timeout = 60000;
let enableProxy = false;
let quietMode = false;
let profileName = null;
let profileFile = null;
let detectMode = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--code' && i + 1 < args.length) {
        codeString = args[++i];
    } else if (arg === '--env' && i + 1 < args.length) {
        envFile = args[++i];
    } else if (arg === '--timeout' && i + 1 < args.length) {
        timeout = parseInt(args[++i]);
    } else if (arg === '--proxy' || arg === '-p') {
        enableProxy = true;
    } else if (arg === '--quiet' || arg === '-q') {
        quietMode = true;
    } else if (arg === '--profile' && i + 1 < args.length) {
        profileName = args[++i];
    } else if (arg === '--profile-file' && i + 1 < args.length) {
        profileFile = args[++i];
    } else if (arg === '--detect' || arg === '-d') {
        detectMode = true;
    } else if (arg === '--help' || arg === '-h') {
        console.log(`
沙箱脚本运行器 v2.0

用法:
  node standalone-runner.js [选项] <脚本文件>
  node standalone-runner.js --code "<JS代码>"

选项:
  --code <代码>           直接执行代码字符串
  --env <文件>            加载环境文件（JSON或JS）
  --profile <名称>        加载指纹配置（从 profiles/ 目录）
  --profile-file <路径>   加载自定义指纹配置文件
  --detect, -d           自动检测模式（报告缺失的 API）
  --proxy, -p            启用高级代理监控（记录所有属性访问）
  --quiet, -q            静默模式（减少日志输出）
  --timeout <毫秒>        设置超时时间（默认60000ms）
  --help, -h             显示帮助信息

示例:
  node standalone-runner.js test.js
  node standalone-runner.js --profile default test.js         # 使用默认指纹配置
  node standalone-runner.js --profile-file ./my.json test.js  # 自定义配置
  node standalone-runner.js --detect test.js                  # 检测缺失 API
  node standalone-runner.js --proxy test.js                   # 启用代理监控
  node standalone-runner.js --env environment.json script.js
  node standalone-runner.js --profile default --proxy test.js # 配置+代理
        `);
        process.exit(0);
    } else if (!scriptFile && !codeString) {
        scriptFile = arg;
    }
}

// 创建沙箱
if (!quietMode) {
    const flags = [];
    if (profileName || profileFile) flags.push('Profile');
    if (enableProxy) flags.push('Proxy');
    if (detectMode) flags.push('Detect');
    const flagStr = flags.length > 0 ? ` [${flags.join('+')}]` : '';
    console.log(`🚀 启动沙箱环境...${flagStr}\n`);
}

// 创建沙箱上下文
const sandbox = {
    console: {
        log: (...args) => {
            if (!quietMode) console.log('[Sandbox]', ...args);
            sandbox.__output__.push(['log', ...args]);
        },
        error: (...args) => {
            console.error('[Sandbox]', ...args);
            sandbox.__output__.push(['error', ...args]);
        },
        warn: (...args) => {
            if (!quietMode) console.warn('[Sandbox]', ...args);
            sandbox.__output__.push(['warn', ...args]);
        },
        info: (...args) => {
            if (!quietMode) console.info('[Sandbox]', ...args);
            sandbox.__output__.push(['info', ...args]);
        }
    },
    setTimeout: (fn, delay) => 0,
    setInterval: (fn, delay) => 0,
    clearTimeout: (id) => {},
    clearInterval: (id) => {},
    atob: (str) => Buffer.from(str, 'base64').toString('binary'),
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    XMLHttpRequest: class XMLHttpRequest {
        constructor() { this.bdmsInvokeList = []; }
        open() {}
        send() {}
        setRequestHeader() {}
    },
    __output__: []
};

// 添加全局引用
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// 创建 VM 上下文
const context = vm.createContext(sandbox);

// 辅助函数：加载 env 模块到 context
function loadEnvModule(relativePath) {
    const fullPath = path.join(__dirname, relativePath);
    if (fs.existsSync(fullPath)) {
        const code = fs.readFileSync(fullPath, 'utf-8');
        try {
            vm.runInContext(code, context, { timeout });
        } catch (e) {
            if (!quietMode) console.warn(`  ⚠ ${relativePath}: ${e.message}`);
        }
        return true;
    }
    return false;
}

// ==================== 加载 Profile ====================
if (profileName || profileFile) {
    let profilePath;
    if (profileFile) {
        profilePath = path.resolve(profileFile);
    } else {
        profilePath = path.join(__dirname, 'profiles', `${profileName}.json`);
    }

    if (!fs.existsSync(profilePath)) {
        console.error(`✗ Profile 不存在: ${profilePath}`);
        process.exit(1);
    }

    try {
        const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        sandbox.__profile__ = profileData;
        if (!quietMode) console.log(`✓ Profile 已加载: ${profileData.meta?.name || profileName || profileFile}`);
    } catch (e) {
        console.error(`✗ Profile 解析失败: ${e.message}`);
        process.exit(1);
    }

    // 加载 ProfileManager
    loadEnvModule('env/core/ProfileManager.js');

    // 自动加载完整环境模块
    if (!quietMode) console.log('  加载环境模块...');

    // 核心监控
    loadEnvModule('env/core/EnvMonitor.js');
    loadEnvModule('env/core/MonitorSystem.js');

    // BOM
    loadEnvModule('env/bom/navigator.js');
    loadEnvModule('env/bom/screen.js');
    loadEnvModule('env/bom/window.js');
    loadEnvModule('env/bom/location.js');
    loadEnvModule('env/bom/history.js');
    loadEnvModule('env/bom/storage.js');
    loadEnvModule('env/bom/crypto.js');
    loadEnvModule('env/bom/performance.js');

    // DOM
    loadEnvModule('env/dom/event.js');
    loadEnvModule('env/dom/document.js');
    loadEnvModule('env/dom/elements.js');

    // WebAPI
    loadEnvModule('env/webapi/audio.js');
    loadEnvModule('env/encoding/textencoder.js');
    loadEnvModule('env/timer/timeout.js');

    if (!quietMode) console.log('  ✓ 环境模块加载完成\n');
}

// ==================== 加载代理监控 ====================
if (enableProxy) {
    const proxyMonitorPath = path.join(__dirname, 'env/core/ProxyMonitor.js');
    const proxyEnvPath = path.join(__dirname, 'env/core/ProxyEnv.js');

    if (fs.existsSync(proxyMonitorPath)) {
        const proxyCode = fs.readFileSync(proxyMonitorPath, 'utf-8');
        vm.runInContext(proxyCode, context);
        if (!quietMode) console.log('✓ 代理监控已加载');
    }

    if (fs.existsSync(proxyEnvPath)) {
        const envCode = fs.readFileSync(proxyEnvPath, 'utf-8');
        vm.runInContext(envCode, context);
        if (!quietMode) console.log('✓ 代理环境已加载\n');
    }
}

// ==================== 加载 AutoDetector ====================
if (detectMode) {
    loadEnvModule('env/core/AutoDetector.js');
    try {
        vm.runInContext('if(window.__AutoDetector__)window.__AutoDetector__.enable()', context);
    } catch (e) {}
    if (!quietMode) console.log('✓ 自动检测模式已启用\n');
}

// ==================== 加载环境文件 ====================
if (envFile) {
    if (!quietMode) console.log(`📦 加载环境文件: ${envFile}`);
    try {
        const envPath = path.resolve(envFile);
        if (fs.existsSync(envPath)) {
            const envCode = fs.readFileSync(envPath, 'utf-8');

            if (envFile.endsWith('.json')) {
                const envData = JSON.parse(envCode);
                Object.assign(sandbox.window, envData);
            } else {
                vm.runInContext(envCode, context, { timeout });
            }
            if (!quietMode) console.log('✓ 环境加载成功\n');
        } else {
            console.error(`✗ 环境文件不存在: ${envPath}`);
            process.exit(1);
        }
    } catch (e) {
        console.error(`✗ 加载环境失败: ${e.message}`);
        process.exit(1);
    }
}

// ==================== 获取要执行的代码 ====================
let code = codeString;

if (!code && scriptFile) {
    const scriptPath = path.resolve(scriptFile);
    if (!fs.existsSync(scriptPath)) {
        console.error(`✗ 脚本文件不存在: ${scriptPath}`);
        process.exit(1);
    }
    if (!quietMode) console.log(`📜 执行脚本: ${scriptFile}\n`);
    code = fs.readFileSync(scriptPath, 'utf-8');
} else if (code) {
    if (!quietMode) console.log(`📝 执行代码...\n`);
}

if (!code) {
    console.error('✗ 请提供脚本文件或使用 --code 指定代码');
    console.log('使用 --help 查看帮助信息');
    process.exit(1);
}

// ==================== 执行代码 ====================
if (!quietMode) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('执行结果:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

const startTime = Date.now();
let result;
let error = null;

const accessLog = [];
const callLog = [];

sandbox.__logAccess__ = (p, type) => {
    accessLog.push({ path: p, type, time: Date.now() - startTime });
};
sandbox.__logCall__ = (p, argTypes) => {
    callLog.push({ path: p, argTypes, time: Date.now() - startTime });
};

try {
    sandbox.__output__ = [];

    result = vm.runInContext(code, context, {
        timeout: timeout,
        displayErrors: true
    });

    const output = sandbox.__output__;

    if (output && output.length > 0 && !quietMode) {
        console.log('📋 控制台输出:');
        output.forEach(([type, ...args]) => {
            const prefix = type === 'error' ? '❌' : type === 'warn' ? '⚠️' : type === 'info' ? 'ℹ️' : '  ';
            console.log(`${prefix} ${args.join(' ')}`);
        });
        console.log();
    }

    if (result !== undefined) {
        console.log('📤 返回值:');
        if (typeof result === 'object') {
            try {
                console.log(JSON.stringify(result, null, 2));
            } catch (e) {
                console.log(result);
            }
        } else {
            console.log(result);
        }
        console.log();
    }

    if ((accessLog.length > 0 || callLog.length > 0) && !quietMode) {
        console.log('📊 执行统计:');
        console.log(`   属性访问: ${accessLog.length} 次`);
        console.log(`   方法调用: ${callLog.length} 次`);

        if (accessLog.length > 0) {
            console.log('\n   最近访问的属性:');
            accessLog.slice(0, 5).forEach(log => {
                console.log(`   - ${log.path} (${log.type}) @${log.time}ms`);
            });
        }

        if (callLog.length > 0) {
            console.log('\n   最近调用的方法:');
            callLog.slice(0, 5).forEach(log => {
                console.log(`   - ${log.path} @${log.time}ms`);
            });
        }
        console.log();
    }

} catch (e) {
    error = e;
    console.error('❌ 执行错误:');
    console.error(e.message);
    if (e.stack && !quietMode) {
        console.error('\n堆栈跟踪:');
        console.error(e.stack);
    }

    // 在 detect 模式下捕获错误
    if (detectMode) {
        try {
            vm.runInContext(`window.__AutoDetector__.captureError({message:${JSON.stringify(e.message)},stack:${JSON.stringify(e.stack || '')}})`, context);
        } catch (e2) {}
    }
}

// ==================== 统计信息 ====================
const duration = Date.now() - startTime;

if (enableProxy) {
    try {
        const stats = vm.runInContext('__ProxyMonitor__.getStats()', context);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 代理监控统计:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   执行时间: ${duration}ms`);
        console.log(`   状态: ${error ? '❌ 失败' : '✅ 成功'}`);
        console.log(`   属性访问 (get): ${stats.get} 次`);
        console.log(`   属性设置 (set): ${stats.set} 次`);
        console.log(`   函数调用 (apply): ${stats.call} 次`);
        console.log(`   构造调用 (construct): ${stats.construct} 次`);
        console.log(`   总操作数: ${stats.total} 次`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } catch (e) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`执行时间: ${duration}ms | 状态: ${error ? '❌ 失败' : '✅ 成功'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
} else if (!detectMode) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`执行时间: ${duration}ms | 状态: ${error ? '❌ 失败' : '✅ 成功'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ==================== 自动检测报告 ====================
if (detectMode) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 自动检测报告:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   执行时间: ${duration}ms | 状态: ${error ? '❌ 失败' : '✅ 成功'}`);

    try {
        const report = vm.runInContext('JSON.stringify(window.__AutoDetector__.getReport())', context);
        const parsed = JSON.parse(report);

        console.log(`   缺失 API: ${parsed.summary.totalMissing} 个`);
        console.log(`   运行时错误: ${parsed.summary.totalErrors} 个`);

        if (parsed.summary.criticalAPIs.length > 0) {
            console.log(`\n   ⚠️  关键缺失:`);
            parsed.summary.criticalAPIs.forEach(api => {
                console.log(`      - ${api}`);
            });
        }

        if (parsed.missingAPIs.length > 0) {
            console.log(`\n   📋 缺失属性 (前20个):`);
            parsed.missingAPIs.slice(0, 20).forEach(item => {
                console.log(`      - ${item.path}`);
            });
            if (parsed.missingAPIs.length > 20) {
                console.log(`      ... 还有 ${parsed.missingAPIs.length - 20} 个`);
            }
        }

        if (parsed.suggestions.length > 0) {
            console.log(`\n   💡 建议加载:`);
            parsed.suggestions.forEach(s => {
                console.log(`      - ${s.module} (${s.reason})`);
            });
        }
    } catch (e) {
        console.log(`   ⚠️  无法获取检测报告: ${e.message}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

process.exit(error ? 1 : 0);
