#!/usr/bin/env node
/**
 * 日志查看工具
 * 运行代码并显示详细的执行日志
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析参数
const scriptFile = process.argv[2];

if (!scriptFile || scriptFile === '--help') {
    console.log(`
日志查看工具 - 运行代码并显示详细日志

用法:
  node view-logs.js <script.js>

示例:
  node view-logs.js a_bogus119.js
  node view-logs.js test.js
    `);
    process.exit(0);
}

// 读取代码
const scriptPath = path.resolve(scriptFile);
if (!fs.existsSync(scriptPath)) {
    console.error(`✗ 文件不存在: ${scriptPath}`);
    process.exit(1);
}

const code = fs.readFileSync(scriptPath, 'utf-8');

// 日志收集
const logs = {
    propertyAccess: [],
    functionCalls: [],
    objectCreation: [],
    console: []
};

// 创建沙箱
const sandbox = {
    // 包装 console
    console: {
        log: (...args) => {
            logs.console.push({ type: 'log', args, time: Date.now() });
            console.log('[Sandbox]', ...args);
        },
        error: (...args) => {
            logs.console.push({ type: 'error', args, time: Date.now() });
            console.error('[Sandbox]', ...args);
        },
        warn: (...args) => {
            logs.console.push({ type: 'warn', args, time: Date.now() });
            console.warn('[Sandbox]', ...args);
        },
        info: (...args) => {
            logs.console.push({ type: 'info', args, time: Date.now() });
            console.info('[Sandbox]', ...args);
        }
    },
    atob: (str) => {
        logs.functionCalls.push({ func: 'atob', args: [str.substring(0, 20) + '...'], time: Date.now() });
        return Buffer.from(str, 'base64').toString('binary');
    },
    btoa: (str) => {
        logs.functionCalls.push({ func: 'btoa', args: [str.substring(0, 20)], time: Date.now() });
        return Buffer.from(str, 'binary').toString('base64');
    },
    XMLHttpRequest: class XMLHttpRequest {
        constructor() {
            logs.objectCreation.push({ type: 'XMLHttpRequest', time: Date.now() });
            this.bdmsInvokeList = [];
        }
        open(...args) {
            logs.functionCalls.push({ func: 'XMLHttpRequest.open', args: args.slice(0, 2), time: Date.now() });
        }
        send() {
            logs.functionCalls.push({ func: 'XMLHttpRequest.send', args: [], time: Date.now() });
        }
        setRequestHeader(name, value) {
            logs.functionCalls.push({ func: 'XMLHttpRequest.setRequestHeader', args: [name], time: Date.now() });
        }
    },
    setTimeout: (fn, delay) => 0,
    setInterval: (fn, delay) => 0,
    clearTimeout: (id) => {},
    clearInterval: (id) => {}
};

sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

// 创建上下文
const context = vm.createContext(sandbox);

// 执行
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`执行: ${scriptFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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

// 显示结果
console.log('\n📊 执行统计:');
console.log(`   执行时间: ${duration}ms`);
console.log(`   状态: ${error ? '❌ 失败' : '✅ 成功'}`);
console.log(`   控制台输出: ${logs.console.length} 条`);
console.log(`   函数调用: ${logs.functionCalls.length} 次`);
console.log(`   对象创建: ${logs.objectCreation.length} 个`);

// 显示详细日志
if (logs.console.length > 0) {
    console.log('\n📋 控制台输出:');
    logs.console.forEach((log, i) => {
        const prefix = log.type === 'error' ? '❌' : log.type === 'warn' ? '⚠️' : log.type === 'info' ? 'ℹ️' : '  ';
        console.log(`   ${i + 1}. ${prefix} ${log.args.join(' ')}`);
    });
}

if (logs.functionCalls.length > 0) {
    console.log('\n🔧 函数调用 (前10条):');
    logs.functionCalls.slice(0, 10).forEach((log, i) => {
        const argsStr = log.args.map(a => typeof a === 'string' ? `"${a}"` : a).join(', ');
        console.log(`   ${i + 1}. ${log.func}(${argsStr})`);
    });
    if (logs.functionCalls.length > 10) {
        console.log(`   ... 还有 ${logs.functionCalls.length - 10} 条`);
    }
}

if (logs.objectCreation.length > 0) {
    console.log('\n🏗️  对象创建:');
    const types = {};
    logs.objectCreation.forEach(log => {
        types[log.type] = (types[log.type] || 0) + 1;
    });
    Object.entries(types).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} 个`);
    });
}

if (result !== undefined) {
    console.log('\n📤 返回值:');
    console.log(`   ${result}`);
}

if (error) {
    console.log('\n❌ 错误信息:');
    console.log(`   ${error.message}`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

process.exit(error ? 1 : 0);
