/**
 * 沙箱管理器
 * 基于isolated-vm实现安全的JS执行环境
 * 支持环境注入、快照保存/加载
 */

import { VM } from 'vm2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyLogger } from './ProxyLogger.js';
import { DeepProxy } from './DeepProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_DIR = path.join(__dirname, '../../env');
const SNAPSHOTS_DIR = path.join(__dirname, '../../snapshots');

export class SandboxManager {
    constructor() {
        this.isolate = null;
        this.context = null;
        this.logger = new ProxyLogger();
        this.deepProxy = new DeepProxy(this.logger);
        this.loadedEnvFiles = [];
    }

    /**
     * 初始化沙箱
     */
    async init(options = {}) {
        const { memoryLimit = 128, timeout = 5000 } = options;

        // 创建 VM2 沙箱
        this.vm = new VM({
            timeout,
            sandbox: {},
            eval: false,
            wasm: false
        });

        // 注入基础环境
        await this._injectBaseEnvironment();
        
        // 注入日志回调
        await this._injectLogCallback();

        return this;
    }

    /**
     * 注入基础环境
     */
    async _injectBaseEnvironment() {
        // vm2 中不能直接 freeze console，需要通过代码注入
        // 创建安全的 console 对象

        // 在 vm2 中注入初始化代码
        const initCode = `
            // 创建安全的 console 对象
            const console = {
                log: (...args) => {},
                error: (...args) => {},
                warn: (...args) => {},
                info: (...args) => {}
            };
            global.console = console;
            
            // 创建 window 对象
            const window = global;
            global.window = window;
            global.self = window;
            global.globalThis = window;
            
            // 注入基础函数
            global.setTimeout = (fn, delay) => 0;
            global.setInterval = (fn, delay) => 0;
            global.clearTimeout = (id) => {};
            global.clearInterval = (id) => {};
            global.atob = (str) => {
                // 简化的 base64 解码
                return str;
            };
            global.btoa = (str) => {
                // 简化的 base64 编码
                return str;
            };

            // 基础undefined记录
            const __undefinedPaths__ = [];
            global.__recordUndefined__ = function(path, context) {
                if (!__undefinedPaths__.includes(path)) {
                    __undefinedPaths__.push(path);
                    
                    // 如果存在 EnvMonitor，也记录到那里
                    if (typeof __logUndefined__ === 'function') {
                        __logUndefined__(path, context);
                    }
                }
            };
            global.__getUndefinedPaths__ = function() {
                return __undefinedPaths__;
            };

            // 增强的深度代理工厂函数
            global.__createProxy__ = function(obj, rootPath) {
                // 用于检测循环引用
                const seen = new WeakSet();
                // 缓存已代理的对象
                const proxyCache = new WeakMap();
                
                // 跳过的属性列表
                const skipProps = ['constructor', 'prototype', '__proto__', 'toJSON', 'valueOf', 'toString', 
                                   'Symbol', 'then', 'catch', 'finally', '__esModule', '$$typeof'];
                
                /**
                 * 递归创建深度代理
                 */
                function createDeepProxy(target, currentPath) {
                    // 基础类型直接返回
                    if (target === null || target === undefined) {
                        return target;
                    }
                    
                    const targetType = typeof target;
                    if (targetType !== 'object' && targetType !== 'function') {
                        return target;
                    }
                    
                    // 检查循环引用
                    if (seen.has(target)) {
                        return target;
                    }
                    
                    // 检查代理缓存
                    if (proxyCache.has(target)) {
                        return proxyCache.get(target);
                    }
                    
                    // 标记已访问
                    seen.add(target);
                    
                    // 创建 Proxy handler
                    const handler = {
                        get(t, prop, receiver) {
                            // Symbol 属性直接返回
                            if (typeof prop === 'symbol') {
                                return Reflect.get(t, prop, receiver);
                            }
                            
                            // 跳过特殊属性
                            if (skipProps.includes(prop)) {
                                return Reflect.get(t, prop, receiver);
                            }
                            
                            const fullPath = currentPath ? currentPath + '.' + String(prop) : String(prop);
                            let value;
                            
                            try {
                                value = Reflect.get(t, prop, receiver);
                            } catch (e) {
                                // 访问错误，记录 undefined
                                __recordUndefined__(fullPath, { error: e.message });
                                return undefined;
                            }
                            
                            // 记录访问
                            if (typeof __logAccess__ === 'function') {
                                try {
                                    __logAccess__('get', fullPath, typeof value);
                                } catch (e) {
                                    // 忽略日志错误
                                }
                            }
                            
                            // 记录 undefined
                            if (value === undefined && !(prop in t)) {
                                __recordUndefined__(fullPath);
                            }
                            
                            // 函数特殊处理 - 包装以记录调用
                            if (typeof value === 'function') {
                                return wrapFunction(value, t, fullPath);
                            }
                            
                            // 递归代理对象
                            if (value !== null && typeof value === 'object') {
                                try {
                                    return createDeepProxy(value, fullPath);
                                } catch (e) {
                                    // 某些对象无法代理，直接返回
                                    return value;
                                }
                            }
                            
                            return value;
                        },
                        
                        set(t, prop, value, receiver) {
                            const fullPath = currentPath ? currentPath + '.' + String(prop) : String(prop);
                            
                            // 记录设置操作
                            if (typeof __logAccess__ === 'function') {
                                __logAccess__('set', fullPath, value);
                            }
                            
                            return Reflect.set(t, prop, value, receiver);
                        },
                        
                        has(t, prop) {
                            return Reflect.has(t, prop);
                        },
                        
                        ownKeys(t) {
                            return Reflect.ownKeys(t);
                        },
                        
                        getOwnPropertyDescriptor(t, prop) {
                            return Reflect.getOwnPropertyDescriptor(t, prop);
                        },
                        
                        defineProperty(t, prop, descriptor) {
                            const fullPath = currentPath ? currentPath + '.' + String(prop) : String(prop);
                            
                            if (typeof __logAccess__ === 'function') {
                                __logAccess__('define', fullPath, descriptor.value);
                            }
                            
                            return Reflect.defineProperty(t, prop, descriptor);
                        },
                        
                        deleteProperty(t, prop) {
                            const fullPath = currentPath ? currentPath + '.' + String(prop) : String(prop);
                            
                            if (typeof __logAccess__ === 'function') {
                                __logAccess__('delete', fullPath, undefined);
                            }
                            
                            return Reflect.deleteProperty(t, prop);
                        }
                    };
                    
                    // 创建代理
                    const proxy = new Proxy(target, handler);
                    
                    // 缓存代理对象
                    proxyCache.set(target, proxy);
                    
                    return proxy;
                }
                
                /**
                 * 包装函数以记录调用
                 */
                function wrapFunction(fn, thisArg, path) {
                    // 如果已经是包装过的函数，直接返回
                    if (fn.__isWrapped__) {
                        return fn;
                    }
                    
                    const wrapped = function(...args) {
                        let result;
                        let error = null;
                        
                        try {
                            result = fn.apply(thisArg, args);
                        } catch (e) {
                            error = e;
                            
                            // 记录调用错误
                            if (typeof __logCall__ === 'function') {
                                __logCall__(path, args, '[Error: ' + e.message + ']');
                            }
                            
                            throw e;
                        }
                        
                        // 记录成功调用
                        if (typeof __logCall__ === 'function') {
                            try {
                                // 序列化参数为 JSON（isolated-vm 需要可序列化的数据）
                                const argsJson = JSON.stringify(args.map(arg => {
                                    if (arg === null) return 'null';
                                    if (arg === undefined) return 'undefined';
                                    if (typeof arg === 'function') return '[Function]';
                                    if (typeof arg === 'object') return '[Object]';
                                    return arg;
                                }));
                                
                                const resultStr = typeof result === 'object' ? '[Object]' : 
                                                 typeof result === 'function' ? '[Function]' : String(result);
                                
                                __logCall__(path, argsJson, resultStr);
                            } catch (e) {
                                // 忽略日志错误
                            }
                        }
                        
                        // 如果返回值是对象，也需要代理
                        if (result !== null && typeof result === 'object') {
                            try {
                                return createDeepProxy(result, path + '()');
                            } catch (e) {
                                // 某些对象无法代理，直接返回
                                return result;
                            }
                        }
                        
                        return result;
                    };
                    
                    // 标记为已包装
                    wrapped.__isWrapped__ = true;
                    
                    // 保持函数属性
                    try {
                        Object.defineProperty(wrapped, 'name', { 
                            value: fn.name || 'anonymous',
                            configurable: true 
                        });
                        Object.defineProperty(wrapped, 'length', { 
                            value: fn.length,
                            configurable: true 
                        });
                    } catch (e) {
                        // 某些情况下无法设置这些属性，忽略错误
                    }
                    
                    return wrapped;
                }
                
                // 开始创建代理
                return createDeepProxy(obj, rootPath);
            };
            
            console.log('[Sandbox] Enhanced deep proxy system initialized');
        `;

        this.vm.run(initCode);
    }

    /**
     * 注入日志回调
     * 将沙箱内的日志调用桥接到外部 ProxyLogger
     */
    async _injectLogCallback() {
        // vm2 不支持直接传递函数，需要通过其他方式
        // 我们将日志存储在沙箱内部，然后定期读取
        const logCallbackCode = `
            // 创建日志存储
            global.__sandboxLogs__ = {
                undefined: [],
                access: [],
                calls: []
            };
            
            // 日志记录函数
            global.__logUndefined__ = function(path, context) {
                __sandboxLogs__.undefined.push({ path, context, timestamp: Date.now() });
            };
            
            global.__logAccess__ = function(type, path, value) {
                __sandboxLogs__.access.push({ type, path, value, timestamp: Date.now() });
            };
            
            global.__logCall__ = function(path, argsJson, result) {
                __sandboxLogs__.calls.push({ path, argsJson, result, timestamp: Date.now() });
            };
        `;
        
        this.vm.run(logCallbackCode);
    }

    /**
     * 加载环境文件
     */
    async loadEnvFile(filePath) {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ENV_DIR, filePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Environment file not found: ${fullPath}`);
        }

        // 跳过已知有问题的文件（vm2 兼容性问题）
        const skipFiles = ['webapi/url.js', 'webapi/xhr.js'];
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (skipFiles.some(skip => normalizedPath.includes(skip))) {
            console.log(`[SandboxManager] ⊗ Skipped (vm2 incompatible): ${filePath}`);
            return { success: true, file: filePath, skipped: true };
        }

        const code = fs.readFileSync(fullPath, 'utf-8');
        
        try {
            // vm2 可能对某些代码有限制，添加保护性包装
            const wrappedCode = `
                try {
                    ${code}
                } catch (e) {
                    console.log('[ENV] Load error in ${filePath}:', e.message);
                }
            `;
            this.vm.run(wrappedCode);
            this.loadedEnvFiles.push(filePath);
            console.log(`[SandboxManager] ✓ Loaded: ${filePath}`);
            return { success: true, file: filePath };
        } catch (e) {
            console.error(`[SandboxManager] ✗ Failed to load ${filePath}:`, e.message);
            // 不抛出错误，继续加载其他文件
            return { success: false, file: filePath, error: e.message };
        }
    }

    /**
     * 加载所有环境文件
     */
    async loadAllEnvFiles() {
        const results = [];
        
        // 加载顺序：core (监控系统) -> bom -> dom -> webapi -> encoding -> timer -> ai-generated
        // core 必须首先加载，因为其他模块依赖监控系统
        const order = ['core', 'bom', 'dom', 'webapi', 'encoding', 'timer', 'ai-generated'];
        
        for (const category of order) {
            const categoryPath = path.join(ENV_DIR, category);
            if (fs.existsSync(categoryPath)) {
                let files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
                
                // core 目录：确保 EnvMonitor.js 首先加载
                if (category === 'core') {
                    // EnvMonitor 必须第一个加载（是新的监控核心）
                    const priorityFiles = ['EnvMonitor.js', 'MonitorSystem.js'];
                    for (const pf of priorityFiles) {
                        const monitorFile = files.find(f => f === pf);
                        if (monitorFile) {
                            const result = await this.loadEnvFile(path.join(category, monitorFile));
                            results.push(result);
                        }
                    }
                    // 加载其他 core 文件（排除已加载的）
                    files = files.filter(f => !priorityFiles.includes(f) && f !== '_index.js');
                }
                
                // dom 目录：确保 document.js 在 elements.js 之前加载
                if (category === 'dom') {
                    const priorityOrder = ['event.js', 'document.js', 'elements.js'];
                    // 按优先顺序加载
                    for (const pf of priorityOrder) {
                        if (files.includes(pf)) {
                            const result = await this.loadEnvFile(path.join(category, pf));
                            results.push(result);
                        }
                    }
                    // 加载剩余的dom文件
                    files = files.filter(f => !priorityOrder.includes(f) && f !== '_index.js');
                }
                
                // ai-generated 目录特殊处理：先注入文件内容，再加载 _index.js
                if (category === 'ai-generated') {
                    const aiResult = await this._loadAIGeneratedFiles(categoryPath, files);
                    results.push(...aiResult);
                    continue;
                }
                
                // 其他目录正常加载（排除 _index.js）
                files = files.filter(f => f !== '_index.js');
                
                for (const file of files) {
                    const result = await this.loadEnvFile(path.join(category, file));
                    results.push(result);
                }
            }
        }

        return results;
    }

    /**
     * 加载 AI 生成的文件
     * 特殊处理：先读取所有文件内容，注入到沙箱，再执行 _index.js
     */
    async _loadAIGeneratedFiles(categoryPath, files) {
        const results = [];
        
        // 1. 读取所有 AI 生成的文件内容（除了 _index.js）
        const aiFiles = files.filter(f => f !== '_index.js');
        const fileContents = {};
        
        for (const file of aiFiles) {
            const filePath = path.join(categoryPath, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                fileContents[file] = content;
            } catch (e) {
                console.error(`[SandboxManager] Failed to read AI file ${file}:`, e.message);
            }
        }
        
        // 2. 注入文件内容到沙箱
        const injectCode = `
            // 注入 AI 文件内容供 _index.js 使用
            window.__aiFileContents__ = ${JSON.stringify(fileContents)};
            console.log('[SandboxManager] Injected', Object.keys(window.__aiFileContents__).length, 'AI file contents');
        `;
        
        try {
            this.vm.run(injectCode);
            results.push({
                success: true,
                file: 'ai-generated/[injection]',
                message: `Injected ${Object.keys(fileContents).length} AI file contents`
            });
        } catch (e) {
            results.push({
                success: false,
                file: 'ai-generated/[injection]',
                error: e.message
            });
        }
        
        // 3. 加载 _index.js（它会自动执行所有注入的文件）
        const indexFile = files.find(f => f === '_index.js');
        if (indexFile) {
            const result = await this.loadEnvFile(path.join('ai-generated', indexFile));
            results.push(result);
            
            // 记录已加载的 AI 文件
            this.loadedEnvFiles.push(...aiFiles.map(f => `ai-generated/${f}`));
        }
        
        return results;
    }

    /**
     * 重新加载 AI 生成的文件
     * 用于热重载，不需要重置整个沙箱
     */
    async reloadAIGeneratedFiles() {
        const categoryPath = path.join(ENV_DIR, 'ai-generated');
        
        if (!fs.existsSync(categoryPath)) {
            return { success: false, error: 'AI-generated directory not found' };
        }
        
        const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
        const results = await this._loadAIGeneratedFiles(categoryPath, files);
        
        return {
            success: true,
            results,
            message: `Reloaded ${files.length - 1} AI-generated files`
        };
    }

    /**
     * 注入代码
     */
    async inject(code) {
        try {
            // 包装代码以捕获运行时错误
            const wrappedCode = `
                (function() {
                    try {
                        ${code}
                    } catch (e) {
                        console.log('[Inject Error]:', e.message);
                        throw e;
                    }
                })();
            `;
            this.vm.run(wrappedCode);
            return { success: true };
        } catch (e) {
            console.error('[SandboxManager] Inject error:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * 执行代码
     */
    async execute(code, options = {}) {
        const { timeout = 5000 } = options;
        
        const startTime = Date.now();
        
        try {
            // 包装用户代码
            const wrappedCode = `
                (function() {
                    ${code}
                })();
            `;
            const result = this.vm.run(wrappedCode);
            const undefinedPaths = await this._getUndefinedPaths();
            
            return {
                success: true,
                result: this._serializeResult(result),
                duration: Date.now() - startTime,
                undefinedPaths: undefinedPaths,
                logs: this.logger.getAllLogs()
            };
        } catch (e) {
            console.error('[SandboxManager] Execute error:', e.message);
            const undefinedPaths = await this._getUndefinedPaths();
            
            return {
                success: false,
                error: e.message,
                stack: e.stack,
                duration: Date.now() - startTime,
                undefinedPaths: undefinedPaths,
                logs: this.logger.getAllLogs()
            };
        }
    }

    /**
     * 获取undefined路径列表
     */
    async _getUndefinedPaths() {
        try {
            const result = this.vm.run('__getUndefinedPaths__()');
            
            // 同步沙箱内的日志到外部 logger
            this._syncLogsFromSandbox();
            
            return result;
        } catch (e) {
            return [];
        }
    }
    
    /**
     * 从沙箱同步日志到外部 logger
     */
    _syncLogsFromSandbox() {
        try {
            const sandboxLogs = this.vm.run('__sandboxLogs__');
            
            if (sandboxLogs) {
                // 同步 undefined 日志
                if (sandboxLogs.undefined) {
                    sandboxLogs.undefined.forEach(log => {
                        this.logger.logUndefined(log.path, log.context);
                    });
                }
                
                // 同步 access 日志
                if (sandboxLogs.access) {
                    sandboxLogs.access.forEach(log => {
                        this.logger.logAccess(log.type, log.path, log.value);
                    });
                }
                
                // 同步 call 日志
                if (sandboxLogs.calls) {
                    sandboxLogs.calls.forEach(log => {
                        try {
                            const args = typeof log.argsJson === 'string' ? JSON.parse(log.argsJson) : [];
                            this.logger.logCall(log.path, args, log.result);
                        } catch (e) {
                            this.logger.logCall(log.path, [log.argsJson], log.result);
                        }
                    });
                }
                
                // 清空沙箱日志
                this.vm.run(`
                    __sandboxLogs__.undefined = [];
                    __sandboxLogs__.access = [];
                    __sandboxLogs__.calls = [];
                `);
            }
        } catch (e) {
            // 忽略同步错误
        }
    }

    /**
     * 序列化执行结果
     */
    _serializeResult(result) {
        if (result === undefined) return 'undefined';
        if (result === null) return 'null';
        if (typeof result === 'function') return `[Function: ${result.name || 'anonymous'}]`;
        if (typeof result === 'symbol') return result.toString();
        if (typeof result === 'object') {
            try {
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `[Object: ${result.constructor?.name || 'Object'}]`;
            }
        }
        return String(result);
    }

    /**
     * 保存快照
     */
    async saveSnapshot(name) {
        if (!fs.existsSync(SNAPSHOTS_DIR)) {
            fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
        }

        const snapshot = {
            name,
            createdAt: new Date().toISOString(),
            loadedEnvFiles: this.loadedEnvFiles,
            undefinedLogs: this.logger.undefinedLogs,
            // 注意：isolated-vm不支持完整状态序列化，这里只保存配置信息
        };

        const snapshotPath = path.join(SNAPSHOTS_DIR, `${name}.json`);
        fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

        return { success: true, path: snapshotPath };
    }

    /**
     * 加载快照
     */
    async loadSnapshot(name) {
        const snapshotPath = path.join(SNAPSHOTS_DIR, `${name}.json`);
        
        if (!fs.existsSync(snapshotPath)) {
            throw new Error(`Snapshot not found: ${name}`);
        }

        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

        // 重新初始化沙箱
        await this.dispose();
        await this.init();

        // 加载快照中记录的环境文件
        for (const file of snapshot.loadedEnvFiles) {
            await this.loadEnvFile(file);
        }

        return { success: true, snapshot };
    }

    /**
     * 列出所有快照
     */
    listSnapshots() {
        if (!fs.existsSync(SNAPSHOTS_DIR)) {
            return [];
        }

        return fs.readdirSync(SNAPSHOTS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const content = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, f), 'utf-8'));
                return {
                    name: content.name,
                    createdAt: content.createdAt,
                    envFilesCount: content.loadedEnvFiles?.length || 0
                };
            });
    }

    /**
     * 删除快照
     */
    deleteSnapshot(name) {
        const snapshotPath = path.join(SNAPSHOTS_DIR, `${name}.json`);
        
        if (fs.existsSync(snapshotPath)) {
            fs.unlinkSync(snapshotPath);
            return { success: true };
        }
        
        return { success: false, error: 'Snapshot not found' };
    }

    /**
     * 获取日志记录器
     */
    getLogger() {
        return this.logger;
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            loadedEnvFiles: this.loadedEnvFiles,
            loggerStats: this.logger.getStats(),
            memoryUsage: null // vm2 不提供内存统计
        };
    }

    /**
     * 重置沙箱
     */
    async reset() {
        await this.dispose();
        this.logger.clear();
        this.loadedEnvFiles = [];
        await this.init();
    }

    /**
     * 销毁沙箱
     */
    async dispose() {
        if (this.vm) {
            this.vm = null;
        }
    }
}

export default SandboxManager;
