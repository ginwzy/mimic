/**
 * 日志管理路由
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '../../logs');

const router = express.Router();

/**
 * 获取undefined日志
 * GET /log/undefined
 */
router.get('/undefined', (req, res) => {
    const logPath = path.join(LOGS_DIR, 'undefined.log');
    
    if (!fs.existsSync(logPath)) {
        return res.json({
            success: true,
            data: [],
            total: 0
        });
    }

    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        
        const entries = lines.map(line => {
            const match = line.match(/\[(.*?)\] (.*?)(?:\s+\((.*?)\))?$/);
            if (match) {
                return {
                    timestamp: match[1],
                    path: match[2],
                    status: match[3] || 'unfixed'
                };
            }
            return { path: line, status: 'unfixed' };
        });
        
        res.json({
            success: true,
            data: entries,
            total: entries.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取AI历史日志
 * GET /log/ai-history
 */
router.get('/ai-history', (req, res) => {
    const logPath = path.join(LOGS_DIR, 'ai-history.json');
    
    if (!fs.existsSync(logPath)) {
        return res.json({
            success: true,
            data: [],
            total: 0
        });
    }

    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const history = JSON.parse(content);
        
        res.json({
            success: true,
            data: history,
            total: history.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取所有日志文件列表
 * GET /log/list
 */
router.get('/list', (req, res) => {
    if (!fs.existsSync(LOGS_DIR)) {
        return res.json({
            success: true,
            data: []
        });
    }

    try {
        const files = fs.readdirSync(LOGS_DIR).map(file => {
            const stat = fs.statSync(path.join(LOGS_DIR, file));
            return {
                name: file,
                size: stat.size,
                modifiedAt: stat.mtime
            };
        });
        
        res.json({
            success: true,
            data: files
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
 * POST /log/clear
 * Body: { type: 'undefined' | 'ai-history' | 'all' }
 */
router.post('/clear', (req, res) => {
    const { type = 'all' } = req.body;
    
    try {
        if (!fs.existsSync(LOGS_DIR)) {
            return res.json({
                success: true,
                message: 'No logs to clear'
            });
        }

        const cleared = [];

        if (type === 'undefined' || type === 'all') {
            const undefinedLog = path.join(LOGS_DIR, 'undefined.log');
            if (fs.existsSync(undefinedLog)) {
                fs.unlinkSync(undefinedLog);
                cleared.push('undefined.log');
            }
        }

        if (type === 'ai-history' || type === 'all') {
            const aiHistoryLog = path.join(LOGS_DIR, 'ai-history.json');
            if (fs.existsSync(aiHistoryLog)) {
                fs.writeFileSync(aiHistoryLog, '[]', 'utf-8');
                cleared.push('ai-history.json');
            }
        }

        res.json({
            success: true,
            message: 'Logs cleared',
            cleared
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 导出日志
 * GET /log/export
 */
router.get('/export', (req, res) => {
    if (!fs.existsSync(LOGS_DIR)) {
        return res.status(404).json({
            success: false,
            error: 'No logs directory'
        });
    }

    try {
        const exportData = {};
        
        // 读取所有日志文件
        const files = fs.readdirSync(LOGS_DIR);
        for (const file of files) {
            const filePath = path.join(LOGS_DIR, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            
            if (file.endsWith('.json')) {
                try {
                    exportData[file] = JSON.parse(content);
                } catch {
                    exportData[file] = content;
                }
            } else {
                exportData[file] = content;
            }
        }
        
        res.json({
            success: true,
            exportedAt: new Date().toISOString(),
            data: exportData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
