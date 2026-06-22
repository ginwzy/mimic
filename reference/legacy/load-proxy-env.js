#!/usr/bin/env node
/**
 * 加载完整代理监控环境运行脚本
 * 使用高级 Proxy 监控，记录所有属性访问和方法调用
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析参数
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
    console.log(`
高级代理监控运行器

用法:
  node load-proxy-env.js <script.js> [选项]

选项:
  --quiet              静默模式，不显示详细日志
  --profile <名称>      加载指纹配置（从 profiles/ 目录）
  --profile-file <路径> 加载自定义指纹配置文件

示例:
  node load-proxy-env.js a_bogus119.js
  node load-proxy-env.js test.js --quiet
  node load-proxy-env.js test.js --profile default
    `);
    process.exit(0);
}

let scriptFile = null;
let quietMode = false;
let profileName = null;
let profileFile = null;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--quiet') {
        quietMode = true;
    } else if (arg === '--profile' && i + 1 < args.length) {
        profileName = args[++i];
    } else if (arg === '--profile-file' && i + 1 < args.length) {
        profileFile = args[++i];
    } else if (!scriptFile) {
        scriptFile = arg;
    }
}

if (!scriptFile) {
    console.error('✗ 请提供脚本文件');
    process.exit(1);
}

// 读取脚本
const scriptPath = path.resolve(scriptFile);
if (!fs.existsSync(scriptPath)) {
    console.error(`✗ 文件不存在: ${scriptPath}`);
    process.exit(1);
}

const code = fs.readFileSync(scriptPath, 'utf-8');

// 读取环境模块
const proxyMonitorPath = path.join(__dirname, 'env/core/ProxyMonitor.js');
const proxyEnvPath = path.join(__dirname, 'env/core/ProxyEnv.js');

let proxyMonitorCode = '';
let proxyEnvCode = '';

if (fs.existsSync(proxyMonitorPath)) {
    proxyMonitorCode = fs.readFileSync(proxyMonitorPath, 'utf-8');
}

if (fs.existsSync(proxyEnvPath)) {
    proxyEnvCode = fs.readFileSync(proxyEnvPath, 'utf-8');
}

// 创建沙箱
console.log('🚀 启动高级代理监控环境...\n');

const sandbox = {
    console: {
        log: (...args) => !quietMode && console.log('[Sandbox]', ...args),
        error: (...args) => console.error('[Sandbox]', ...args),
        warn: (...args) => !quietMode && console.warn('[Sandbox]', ...args),
        info: (...args) => !quietMode && console.info('[Sandbox]', ...args)
    },
    setTimeout: (fn, delay) => 0,
    setInterval: (fn, delay) => 0,
    clearTimeout: (id) => {},
    clearInterval: (id) => {},
    atob: (str) => Buffer.from(str, 'base64').toString('binary'),
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    XMLHttpRequest: class XMLHttpRequest {
        constructor() {
            this.bdmsInvokeList = [];
        }
        open() {}
        send() {}
        setRequestHeader() {}
    }
};

sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const context = vm.createContext(sandbox);

// 加载 Profile
if (profileName || profileFile) {
    let profilePath;
    if (profileFile) {
        profilePath = path.resolve(profileFile);
    } else {
        profilePath = path.join(__dirname, 'profiles', `${profileName}.json`);
    }

    if (fs.existsSync(profilePath)) {
        try {
            const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
            sandbox.__profile__ = profileData;
            if (!quietMode) console.log(`✓ Profile 已加载: ${profileData.meta?.name || profileName || profileFile}`);
        } catch (e) {
            console.error(`✗ Profile 解析失败: ${e.message}`);
            process.exit(1);
        }
    } else {
        console.error(`✗ Profile 不存在: ${profilePath}`);
        process.exit(1);
    }

    // 加载 ProfileManager
    const pmPath = path.join(__dirname, 'env/core/ProfileManager.js');
    if (fs.existsSync(pmPath)) {
        vm.runInContext(fs.readFileSync(pmPath, 'utf-8'), context);
    }
}

// 加载代理监控
console.log('📦 加载代理监控模块...');
if (proxyMonitorCode) {
    vm.runInContext(proxyMonitorCode, context);
    console.log('✓ ProxyMonitor 已加载');
}

if (proxyEnvCode) {
    vm.runInContext(proxyEnvCode, context);
    console.log('✓ ProxyEnv 已加载');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`执行: ${scriptFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 执行代码
const startTime = Date.now();
let result;
let error = null;

try {
    result = vm.runInContext(code, context, {
        timeout: 60000,
        displayErrors: true
    });
} catch (e) {
    error = e;
}

const duration = Date.now() - startTime;

// 获取日志统计
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
    
    if (result !== undefined) {
        console.log(`\n📤 返回值: ${result}`);
    }
    
    if (error) {
        console.log(`\n❌ 错误: ${error.message}`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
} catch (e) {
    console.log(`\n⚠️  无法获取代理统计: ${e.message}`);
}

process.exit(error ? 1 : 0);
