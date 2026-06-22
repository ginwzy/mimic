/**
 * 快照管理路由
 */

import express from 'express';
import { SandboxManager } from '../sandbox/index.js';

const router = express.Router();

// 引用沙箱实例（需要从sandbox路由共享）
let getSandboxInstance = null;

export function setSandboxGetter(getter) {
    getSandboxInstance = getter;
}

/**
 * 保存快照
 * POST /snapshot/save
 * Body: { name: 'my-snapshot' }
 */
router.post('/save', async (req, res) => {
    const { name } = req.body;
    
    if (!name) {
        return res.status(400).json({
            success: false,
            error: 'Missing snapshot name'
        });
    }

    // 验证名称格式
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid snapshot name. Use only letters, numbers, underscores and hyphens.'
        });
    }

    try {
        if (!getSandboxInstance) {
            return res.status(500).json({
                success: false,
                error: 'Sandbox not initialized'
            });
        }
        
        const sandbox = await getSandboxInstance();
        const result = await sandbox.saveSnapshot(name);
        
        res.json({
            success: true,
            message: 'Snapshot saved',
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 加载快照
 * POST /snapshot/load
 * Body: { name: 'my-snapshot' }
 */
router.post('/load', async (req, res) => {
    const { name } = req.body;
    
    if (!name) {
        return res.status(400).json({
            success: false,
            error: 'Missing snapshot name'
        });
    }

    try {
        if (!getSandboxInstance) {
            return res.status(500).json({
                success: false,
                error: 'Sandbox not initialized'
            });
        }
        
        const sandbox = await getSandboxInstance();
        const result = await sandbox.loadSnapshot(name);
        
        res.json({
            success: true,
            message: 'Snapshot loaded',
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 列出所有快照
 * GET /snapshot/list
 */
router.get('/list', async (req, res) => {
    try {
        if (!getSandboxInstance) {
            return res.status(500).json({
                success: false,
                error: 'Sandbox not initialized'
            });
        }
        
        const sandbox = await getSandboxInstance();
        const snapshots = sandbox.listSnapshots();
        
        res.json({
            success: true,
            data: snapshots
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 删除快照
 * DELETE /snapshot/:name
 */
router.delete('/:name', async (req, res) => {
    const { name } = req.params;

    try {
        if (!getSandboxInstance) {
            return res.status(500).json({
                success: false,
                error: 'Sandbox not initialized'
            });
        }
        
        const sandbox = await getSandboxInstance();
        const result = sandbox.deleteSnapshot(name);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Snapshot deleted'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Snapshot not found'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
