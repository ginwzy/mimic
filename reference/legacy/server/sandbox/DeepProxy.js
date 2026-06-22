/**
 * 深度递归Proxy代理
 * 全对象、嵌套属性、动态新增属性均代理，处理循环引用
 */

export class DeepProxy {
    constructor(logger) {
        this.logger = logger;
        this.proxyCache = new WeakMap(); // 缓存已代理对象，处理循环引用
    }

    /**
     * 创建深度代理
     * @param {Object} target - 要代理的目标对象
     * @param {string} rootPath - 根路径（如 'window', 'navigator'）
     * @returns {Proxy} 代理对象
     */
    create(target, rootPath = '') {
        return this._createProxy(target, rootPath);
    }

    /**
     * 内部递归创建代理
     */
    _createProxy(obj, currentPath) {
        // 基础类型直接返回
        if (obj === null || obj === undefined) {
            return obj;
        }
        
        if (typeof obj !== 'object' && typeof obj !== 'function') {
            return obj;
        }

        // 检查循环引用
        if (this.proxyCache.has(obj)) {
            return this.proxyCache.get(obj);
        }

        const self = this;
        
        const handler = {
            get(target, prop, receiver) {
                // 处理Symbol
                if (typeof prop === 'symbol') {
                    return Reflect.get(target, prop, receiver);
                }

                // 特殊属性不代理
                const skipProps = ['constructor', 'prototype', '__proto__', 'toJSON', 'valueOf', 'toString'];
                if (skipProps.includes(prop)) {
                    return Reflect.get(target, prop, receiver);
                }

                const fullPath = currentPath ? `${currentPath}.${String(prop)}` : String(prop);
                let value;
                
                try {
                    value = Reflect.get(target, prop, receiver);
                } catch (e) {
                    self.logger.logUndefined(fullPath, `Access error: ${e.message}`);
                    return undefined;
                }

                // 记录访问
                self.logger.logAccess('get', fullPath, value);

                // 记录undefined
                if (value === undefined && prop in target === false) {
                    self.logger.logUndefined(fullPath);
                }

                // 函数特殊处理 - 包装以记录调用
                if (typeof value === 'function') {
                    return self._wrapFunction(value, target, fullPath);
                }

                // 递归代理对象
                if (value !== null && typeof value === 'object') {
                    return self._createProxy(value, fullPath);
                }

                return value;
            },

            set(target, prop, value, receiver) {
                const fullPath = currentPath ? `${currentPath}.${String(prop)}` : String(prop);
                
                // 记录设置操作
                self.logger.logAccess('set', fullPath, value);
                
                return Reflect.set(target, prop, value, receiver);
            },

            has(target, prop) {
                return Reflect.has(target, prop);
            },

            ownKeys(target) {
                return Reflect.ownKeys(target);
            },

            getOwnPropertyDescriptor(target, prop) {
                return Reflect.getOwnPropertyDescriptor(target, prop);
            },

            defineProperty(target, prop, descriptor) {
                const fullPath = currentPath ? `${currentPath}.${String(prop)}` : String(prop);
                self.logger.logAccess('define', fullPath, descriptor.value);
                return Reflect.defineProperty(target, prop, descriptor);
            },

            deleteProperty(target, prop) {
                const fullPath = currentPath ? `${currentPath}.${String(prop)}` : String(prop);
                self.logger.logAccess('delete', fullPath, undefined);
                return Reflect.deleteProperty(target, prop);
            }
        };

        const proxy = new Proxy(obj, handler);
        this.proxyCache.set(obj, proxy);
        
        return proxy;
    }

    /**
     * 包装函数以记录调用
     */
    _wrapFunction(fn, thisArg, path) {
        const self = this;
        
        const wrapped = function(...args) {
            let result;
            try {
                result = fn.apply(thisArg, args);
            } catch (e) {
                self.logger.logCall(path, args, `[Error: ${e.message}]`);
                throw e;
            }
            
            self.logger.logCall(path, args, result);
            
            // 如果返回值是对象，也需要代理
            if (result !== null && typeof result === 'object') {
                return self._createProxy(result, `${path}()`);
            }
            
            return result;
        };

        // 保持函数属性
        Object.defineProperty(wrapped, 'name', { value: fn.name });
        Object.defineProperty(wrapped, 'length', { value: fn.length });
        
        return wrapped;
    }

    /**
     * 清除代理缓存
     */
    clearCache() {
        this.proxyCache = new WeakMap();
    }
}

export default DeepProxy;
