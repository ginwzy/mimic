/**
 * Proxy访问日志记录器
 * 记录所有属性访问、方法调用，并标记undefined项
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '../../logs');

export class ProxyLogger {
    constructor() {
        this.accessLogs = [];
        this.undefinedLogs = [];
        this.callLogs = [];
        this.maxLogs = 10000; // 防止内存溢出
    }

    /**
     * 记录属性访问
     */
    logAccess(type, path, value) {
        const entry = {
            type, // 'get' | 'set'
            path,
            valueType: typeof value,
            value: this._serializeValue(value),
            timestamp: Date.now()
        };
        
        this.accessLogs.push(entry);
        
        // 限制日志数量
        if (this.accessLogs.length > this.maxLogs) {
            this.accessLogs.shift();
        }
    }

    /**
     * 记录undefined访问
     */
    logUndefined(path, context = '') {
        // 去重
        const exists = this.undefinedLogs.find(log => log.path === path);
        if (!exists) {
            const entry = {
                path,
                context,
                timestamp: Date.now(),
                fixed: false,
                fixedBy: null // 'manual' | 'ai' | null
            };
            this.undefinedLogs.push(entry);
        }
    }

    /**
     * 记录方法调用
     */
    logCall(path, args, result) {
        const entry = {
            path,
            args: args.map(arg => this._serializeValue(arg)),
            result: this._serializeValue(result),
            timestamp: Date.now()
        };
        
        this.callLogs.push(entry);
        
        if (this.callLogs.length > this.maxLogs) {
            this.callLogs.shift();
        }
    }

    /**
     * 序列化值（处理循环引用和特殊对象）
     */
    _serializeValue(value) {
        if (value === undefined) return 'undefined';
        if (value === null) return 'null';
        if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
        if (typeof value === 'symbol') return value.toString();
        if (typeof value === 'object') {
            try {
                // 处理特殊对象
                if (value instanceof Error) {
                    return `[Error: ${value.message}]`;
                }
                if (Array.isArray(value)) {
                    return `[Array(${value.length})]`;
                }
                return `[Object: ${value.constructor?.name || 'Object'}]`;
            } catch (e) {
                return '[Object]';
            }
        }
        return String(value).substring(0, 100); // 限制长度
    }

    /**
     * 获取所有日志
     */
    getAllLogs() {
        return {
            access: this.accessLogs,
            undefined: this.undefinedLogs,
            calls: this.callLogs
        };
    }

    /**
     * 获取undefined列表
     */
    getUndefinedList() {
        return this.undefinedLogs.filter(log => !log.fixed);
    }

    /**
     * 标记undefined已修复
     */
    markFixed(path, fixedBy = 'manual') {
        const log = this.undefinedLogs.find(l => l.path === path);
        if (log) {
            log.fixed = true;
            log.fixedBy = fixedBy;
            log.fixedAt = Date.now();
        }
    }

    /**
     * 保存日志到文件
     */
    saveToFile() {
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
        }

        // 保存undefined日志
        const undefinedPath = path.join(LOGS_DIR, 'undefined.log');
        const undefinedContent = this.undefinedLogs
            .map(log => `[${new Date(log.timestamp).toISOString()}] ${log.path} ${log.fixed ? `(fixed by ${log.fixedBy})` : ''}`)
            .join('\n');
        fs.writeFileSync(undefinedPath, undefinedContent);

        return {
            undefinedPath,
            undefinedCount: this.undefinedLogs.length
        };
    }

    /**
     * 清空日志
     */
    clear() {
        this.accessLogs = [];
        this.undefinedLogs = [];
        this.callLogs = [];
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            totalAccess: this.accessLogs.length,
            totalUndefined: this.undefinedLogs.length,
            unfixedUndefined: this.undefinedLogs.filter(l => !l.fixed).length,
            totalCalls: this.callLogs.length
        };
    }
}

export default ProxyLogger;
