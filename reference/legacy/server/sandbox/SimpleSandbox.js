/**
 * 简化的沙箱管理器 - 专注于核心功能
 * 使用 Node.js 原生 vm 模块，支持复杂的混淆代码
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';

export class SimpleSandbox {
    constructor() {
        this.context = null;
        this.undefinedPaths = [];
        this.accessLogs = [];
        this.callLogs = [];
    }

    /**
     * 初始化沙箱
     */
    init(options = {}) {
        const { timeout = 60000, profile = null } = options;

        // 创建沙箱上下文
        const sandbox = {
            console: {
                log: (...args) => {
                    console.log('[Sandbox]', ...args);
                    if (this.context.__consoleOutput__) {
                        this.context.__consoleOutput__.push(['log', ...args]);
                    }
                },
                error: (...args) => {
                    console.error('[Sandbox]', ...args);
                    if (this.context.__consoleOutput__) {
                        this.context.__consoleOutput__.push(['error', ...args]);
                    }
                },
                warn: (...args) => {
                    console.warn('[Sandbox]', ...args);
                    if (this.context.__consoleOutput__) {
                        this.context.__consoleOutput__.push(['warn', ...args]);
                    }
                },
                info: (...args) => {
                    console.info('[Sandbox]', ...args);
                    if (this.context.__consoleOutput__) {
                        this.context.__consoleOutput__.push(['info', ...args]);
                    }
                }
            },
            setTimeout: (fn, delay) => 0,
            setInterval: (fn, delay) => 0,
            clearTimeout: (id) => {},
            clearInterval: (id) => {},
            // Base64 编解码
            atob: (str) => Buffer.from(str, 'base64').toString('binary'),
            btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
            // XMLHttpRequest 基础实现
            XMLHttpRequest: class XMLHttpRequest {
                constructor() {
                    this.bdmsInvokeList = [];
                }
                open() {}
                send() {}
                setRequestHeader() {}
            },
            __consoleOutput__: [],
            __undefinedPaths__: [],
            __profile__: profile || null,
            // 日志记录辅助
            __logAccess__: (path, value) => {
                this.accessLogs.push({
                    path,
                    value: String(value).substring(0, 100),
                    timestamp: Date.now()
                });
            },
            __logCall__: (path, args) => {
                this.callLogs.push({
                    path,
                    args: args || [],
                    timestamp: Date.now()
                });
            }
        };

        // 添加 window 引用
        sandbox.window = sandbox;
        sandbox.global = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.self = sandbox;
        
        // 创建上下文
        this.context = vm.createContext(sandbox);
        this.timeout = timeout;
        
        console.log('[SimpleSandbox] 沙箱初始化完成');
        return this;
    }

    /**
     * 注入基础环境 - 只注入最基础的功能
     */
    _injectBaseEnvironment() {
        // 不需要了，在 init 中已经创建好了
    }

    /**
     * 执行代码
     */
    execute(code, options = {}) {
        const { enableLogging = true } = options;
        const startTime = Date.now();
        
        try {
            // 清空日志
            this.context.__consoleOutput__ = [];
            this.accessLogs = [];
            this.callLogs = [];
            
            // 如果启用日志，注入代理追踪代码
            if (enableLogging) {
                const proxyCode = `
                    // 创建一个追踪 window 访问的代理
                    (function() {
                        const originalWindow = { ...window };
                        const accessedPaths = new Set();
                        
                        // 包装 window 对象
                        const handler = {
                            get(target, prop) {
                                if (prop === '__isProxy__') return true;
                                
                                const path = 'window.' + String(prop);
                                if (!accessedPaths.has(path)) {
                                    accessedPaths.add(path);
                                    if (typeof __logAccess__ === 'function') {
                                        __logAccess__(path, typeof target[prop]);
                                    }
                                }
                                
                                const value = target[prop];
                                
                                // 如果是函数，包装它以记录调用
                                if (typeof value === 'function' && !value.__wrapped__) {
                                    const wrapped = function(...args) {
                                        const callPath = 'window.' + String(prop) + '()';
                                        if (typeof __logCall__ === 'function') {
                                            __logCall__(callPath, args.map(a => typeof a));
                                        }
                                        return value.apply(target, args);
                                    };
                                    wrapped.__wrapped__ = true;
                                    Object.defineProperty(wrapped, 'name', { value: prop });
                                    return wrapped;
                                }
                                
                                return value;
                            }
                        };
                        
                        // 不能直接代理 window，但可以监控访问
                        // 这里我们记录直接访问
                    })();
                `;
                
                try {
                    vm.runInContext(proxyCode, this.context, { timeout: this.timeout });
                } catch (e) {
                    console.log('[SimpleSandbox] Proxy setup skipped:', e.message);
                }
            }
            
            // 使用 vm.runInContext 执行代码
            const result = vm.runInContext(code, this.context, {
                timeout: this.timeout,
                displayErrors: true
            });
            
            // 获取控制台输出
            const consoleOutput = this.context.__consoleOutput__ || [];
            
            return {
                success: true,
                result: this._serializeResult(result),
                duration: Date.now() - startTime,
                consoleOutput: consoleOutput,
                accessLogs: this.accessLogs.slice(-50), // 最近50条
                callLogs: this.callLogs.slice(-50),
                undefinedPaths: []
            };
        } catch (e) {
            console.error('[SimpleSandbox] Execute error:', e.message);
            return {
                success: false,
                error: e.message,
                stack: e.stack,
                duration: Date.now() - startTime,
                consoleOutput: this.context.__consoleOutput__ || [],
                accessLogs: this.accessLogs.slice(-50),
                callLogs: this.callLogs.slice(-50),
                undefinedPaths: []
            };
        }
    }

    /**
     * 注入环境对象（从文件或对象）
     */
    injectEnvironment(envData) {
        try {
            if (typeof envData === 'string') {
                // 如果是文件路径
                if (fs.existsSync(envData)) {
                    const code = fs.readFileSync(envData, 'utf-8');
                    vm.runInContext(code, this.context, { timeout: this.timeout });
                } else {
                    // 如果是代码字符串
                    vm.runInContext(envData, this.context, { timeout: this.timeout });
                }
            } else if (typeof envData === 'object') {
                // 如果是对象，直接注入到上下文
                Object.assign(this.context.window, envData);
            }
            return { success: true };
        } catch (e) {
            console.error('[SimpleSandbox] 注入环境失败:', e.message);
            return { success: false, error: e.message };
        }
    }

    /**
     * 序列化结果
     */
    _serializeResult(result) {
        if (result === undefined) return 'undefined';
        if (result === null) return 'null';
        if (typeof result === 'function') return '[Function]';
        if (typeof result === 'symbol') return result.toString();
        
        if (typeof result === 'object') {
            try {
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return '[Object]';
            }
        }
        
        return String(result);
    }

    /**
     * 重置沙箱
     */
    reset() {
        this.vm = null;
        this.undefinedPaths = [];
        this.init();
    }

    /**
     * 运行文件
     */
    executeFile(filePath) {
        try {
            const code = fs.readFileSync(filePath, 'utf-8');
            return this.execute(code);
        } catch (e) {
            return {
                success: false,
                error: `Failed to read file: ${e.message}`,
                duration: 0,
                consoleOutput: [],
                undefinedPaths: []
            };
        }
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            loadedEnvFiles: [],
            undefinedPaths: this.undefinedPaths,
            consoleOutputCount: this.context?.__consoleOutput__?.length || 0,
            ready: !!this.context,
            engine: 'Node.js VM'
        };
    }

    /**
     * 获取 undefined 列表
     */
    getUndefinedList() {
        return this.undefinedPaths;
    }

    /**
     * 获取日志（兼容接口）
     */
    getLogger() {
        return {
            getAllLogs: () => ({ 
                access: this.accessLogs, 
                undefined: this.undefinedPaths, 
                calls: this.callLogs 
            }),
            getStats: () => ({ 
                totalAccess: this.accessLogs.length, 
                totalUndefined: this.undefinedPaths.length, 
                totalCalls: this.callLogs.length 
            }),
            getUndefinedList: () => this.undefinedPaths,
            clear: () => { 
                this.undefinedPaths = [];
                this.accessLogs = [];
                this.callLogs = [];
            }
        };
    }

    /**
     * 获取环境信息
     */
    getEnvironmentInfo() {
        try {
            const envInfo = vm.runInContext(`
                JSON.stringify({
                    window: typeof window,
                    document: typeof document,
                    navigator: typeof navigator,
                    location: typeof location,
                    console: typeof console,
                    XMLHttpRequest: typeof XMLHttpRequest,
                    atob: typeof atob,
                    btoa: typeof btoa,
                    customProperties: Object.keys(window).filter(k => 
                        !['console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 
                         'atob', 'btoa', 'XMLHttpRequest', 'window', 'global', 'globalThis', 'self',
                         '__consoleOutput__', '__undefinedPaths__', '__logAccess__', '__logCall__'].includes(k)
                    )
                })
            `, this.context);
            return JSON.parse(envInfo);
        } catch (e) {
            return { error: e.message };
        }
    }

    /**
     * 销毁沙箱
     */
    dispose() {
        this.vm = null;
    }
}

export default SimpleSandbox;
