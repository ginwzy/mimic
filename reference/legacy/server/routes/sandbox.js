/**
 * 沙箱执行路由
 */

import express from 'express';
import { SimpleSandbox } from '../sandbox/SimpleSandbox.js';

const router = express.Router();

// 全局沙箱实例（单例模式）
let sandboxInstance = null;

/**
 * 获取沙箱实例 - 使用简化版本
 */
async function getSandbox() {
    if (!sandboxInstance) {
        sandboxInstance = new SimpleSandbox();
        sandboxInstance.init();
    }
    return sandboxInstance;
}

/**
 * 执行JS代码
 * POST /sandbox/run
 * Body: { code: '...', loadEnv: true, timeout: 5000 }
 */
router.post('/run', async (req, res) => {
    const { code, loadEnv = true, timeout = 5000, reset = false } = req.body;
    
    if (!code) {
        return res.status(400).json({
            success: false,
            error: 'Missing code parameter'
        });
    }

    try {
        // 如果需要重置，先销毁旧实例
        if (reset && sandboxInstance) {
            await sandboxInstance.reset();
        }

        const sandbox = await getSandbox();
        
        // 执行代码
        const result = await sandbox.execute(code, { timeout });
        
        res.json({
            success: result.success,
            result: result.result,
            error: result.error,
            stack: result.stack,
            duration: result.duration,
            undefinedPaths: result.undefinedPaths || [],
            consoleOutput: result.consoleOutput || [],
            accessLogs: result.accessLogs || [],
            callLogs: result.callLogs || [],
            stats: {
                accessCount: result.accessLogs?.length || 0,
                callCount: result.callLogs?.length || 0,
                consoleCount: result.consoleOutput?.length || 0
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

/**
 * 注入代码（不执行返回）
 * POST /sandbox/inject
 * Body: { code: '...' }
 */
router.post('/inject', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({
            success: false,
            error: 'Missing code parameter'
        });
    }

    try {
        const sandbox = await getSandbox();
        const result = await sandbox.inject(code);
        
        res.json({
            success: result.success,
            error: result.error
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 加载环境文件
 * POST /sandbox/load-env
 * Body: { file: 'bom/window.js' } 或 { all: true }
 */
router.post('/load-env', async (req, res) => {
    const { file, all = false } = req.body;
    
    try {
        const sandbox = await getSandbox();
        
        if (all) {
            const results = await sandbox.loadAllEnvFiles();
            res.json({
                success: true,
                results
            });
        } else if (file) {
            const result = await sandbox.loadEnvFile(file);
            res.json(result);
        } else {
            res.status(400).json({
                success: false,
                error: 'Missing file parameter or all flag'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 重置沙箱
 * POST /sandbox/reset
 */
router.post('/reset', async (req, res) => {
    try {
        if (sandboxInstance) {
            await sandboxInstance.reset();
        }
        sandboxInstance = null;
        
        // 重新初始化
        await getSandbox();
        
        res.json({
            success: true,
            message: 'Sandbox reset successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取沙箱状态
 * GET /sandbox/status
 */
router.get('/status', async (req, res) => {
    try {
        const sandbox = await getSandbox();
        const envInfo = sandbox.getEnvironmentInfo ? sandbox.getEnvironmentInfo() : {};
        
        res.json({
            success: true,
            data: {
                ready: !!sandbox.context,
                type: 'SimpleSandbox (Node.js VM)',
                stats: sandbox.getStats ? sandbox.getStats() : {},
                environment: envInfo
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取环境信息
 * GET /sandbox/environment
 */
router.get('/environment', async (req, res) => {
    try {
        const sandbox = await getSandbox();
        const envInfo = sandbox.getEnvironmentInfo ? sandbox.getEnvironmentInfo() : {};
        
        res.json({
            success: true,
            data: envInfo
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 执行文件
 * POST /sandbox/run-file
 * Body: { filePath: 'path/to/file.js' }
 */
router.post('/run-file', async (req, res) => {
    const { filePath } = req.body;
    
    if (!filePath) {
        return res.status(400).json({
            success: false,
            error: 'Missing filePath parameter'
        });
    }
    
    try {
        const sandbox = await getSandbox();
        const result = sandbox.executeFile ? 
            sandbox.executeFile(filePath) : 
            { success: false, error: 'executeFile not supported' };
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取undefined列表
 * GET /sandbox/undefined
 */
router.get('/undefined', async (req, res) => {
    try {
        const sandbox = await getSandbox();
        const undefinedList = sandbox.getUndefinedList ? sandbox.getUndefinedList() : [];
        
        res.json({
            success: true,
            data: undefinedList,
            total: undefinedList.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取所有日志
 * GET /sandbox/logs
 */
router.get('/logs', async (req, res) => {
    const { type, limit = 100 } = req.query;
    
    try {
        const sandbox = await getSandbox();
        const logger = sandbox.getLogger ? sandbox.getLogger() : null;
        let logs = logger ? logger.getAllLogs() : { access: [], undefined: [], calls: [] };
        
        if (type) {
            logs = {
                [type]: logs[type] || []
            };
        }
        
        // 限制返回数量
        Object.keys(logs).forEach(key => {
            if (Array.isArray(logs[key]) && logs[key].length > limit) {
                logs[key] = logs[key].slice(-limit);
            }
        });
        
        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 清除日志
 * POST /sandbox/logs/clear
 */
router.post('/logs/clear', async (req, res) => {
    try {
        const sandbox = await getSandbox();
        const logger = sandbox.getLogger ? sandbox.getLogger() : null;
        if (logger && logger.clear) {
            logger.clear();
        }
        
        res.json({
            success: true,
            message: 'Logs cleared'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 注入环境数据
 * POST /sandbox/inject-env
 * Body: { code: '...', data: {...} }
 */
router.post('/inject-env', async (req, res) => {
    const { code, data } = req.body;
    
    try {
        const sandbox = await getSandbox();
        const result = sandbox.injectEnvironment(code || data);
        
        res.json({
            success: result.success,
            error: result.error
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
