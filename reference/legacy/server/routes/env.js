/**
 * 环境文件管理路由
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_DIR = path.join(__dirname, '../../env');

const router = express.Router();

/**
 * 获取环境代码目录结构
 * GET /env/list
 */
router.get('/list', (req, res) => {
    try {
        const structure = getDirectoryStructure(ENV_DIR);
        res.json({
            success: true,
            data: structure
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 读取指定环境文件内容
 * GET /env/file?path=bom/window.js
 */
router.get('/file', (req, res) => {
    const filePath = req.query.path;
    
    if (!filePath) {
        return res.status(400).json({
            success: false,
            error: 'Missing path parameter'
        });
    }

    // 安全检查：防止路径遍历
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid path'
        });
    }

    const fullPath = path.join(ENV_DIR, normalizedPath);
    
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
            success: false,
            error: 'File not found'
        });
    }

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const stat = fs.statSync(fullPath);
        
        res.json({
            success: true,
            data: {
                path: filePath,
                content,
                size: stat.size,
                modifiedAt: stat.mtime
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
 * 写入/更新环境文件
 * POST /env/file
 * Body: { path: 'bom/window.js', content: '...' }
 */
router.post('/file', (req, res) => {
    const { path: filePath, content } = req.body;
    
    if (!filePath || content === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Missing path or content'
        });
    }

    // 安全检查
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid path'
        });
    }

    const fullPath = path.join(ENV_DIR, normalizedPath);
    const dirPath = path.dirname(fullPath);

    try {
        // 确保目录存在
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // 如果文件存在，先备份
        if (fs.existsSync(fullPath)) {
            const backupPath = fullPath + '.backup';
            fs.copyFileSync(fullPath, backupPath);
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
        
        res.json({
            success: true,
            message: 'File saved successfully',
            path: filePath
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 删除环境文件
 * DELETE /env/file?path=ai-generated/xxx.js
 */
router.delete('/file', (req, res) => {
    const filePath = req.query.path;
    
    if (!filePath) {
        return res.status(400).json({
            success: false,
            error: 'Missing path parameter'
        });
    }

    // 只允许删除ai-generated目录下的文件
    if (!filePath.startsWith('ai-generated/')) {
        return res.status(403).json({
            success: false,
            error: 'Only ai-generated files can be deleted'
        });
    }

    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes('..')) {
        return res.status(400).json({
            success: false,
            error: 'Invalid path'
        });
    }

    const fullPath = path.join(ENV_DIR, normalizedPath);
    
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
            success: false,
            error: 'File not found'
        });
    }

    try {
        fs.unlinkSync(fullPath);
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 获取目录结构
 */
function getDirectoryStructure(dirPath, relativePath = '') {
    const items = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
        const itemPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
            items.push({
                name: entry.name,
                path: itemPath,
                type: 'directory',
                children: getDirectoryStructure(path.join(dirPath, entry.name), itemPath)
            });
        } else if (entry.name.endsWith('.js')) {
            const stat = fs.statSync(path.join(dirPath, entry.name));
            items.push({
                name: entry.name,
                path: itemPath,
                type: 'file',
                size: stat.size,
                modifiedAt: stat.mtime
            });
        }
    }
    
    return items;
}

export default router;
