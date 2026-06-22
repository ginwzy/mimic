/**
 * JS逆向沙箱化补环境框架 - 服务入口
 * 
 * 提供以下API:
 * - /api/env/*     - 环境文件管理
 * - /api/sandbox/* - 沙箱执行
 * - /api/ai/*      - AI补环境
 * - /api/snapshot/*- 快照管理
 * - /api/log/*     - 日志管理
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// 路由
import envRouter from './routes/env.js';
import sandboxRouter from './routes/sandbox.js';
import aiRouter, { setSandboxGetter as setAISandboxGetter } from './routes/ai.js';
import snapshotRouter, { setSandboxGetter } from './routes/snapshot.js';
import logRouter from './routes/log.js';
import mockRouter from './routes/mock.js';

// 沙箱管理
import { SimpleSandbox } from './sandbox/SimpleSandbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（前端界面）
app.use(express.static(path.join(__dirname, '../web')));

// API路由
app.use('/api/env', envRouter);
app.use('/api/sandbox', sandboxRouter);
app.use('/api/ai', aiRouter);
app.use('/api/snapshot', snapshotRouter);
app.use('/api/log', logRouter);
app.use('/api/mock', mockRouter);

// 全局沙箱实例
let globalSandbox = null;

async function getGlobalSandbox() {
    if (!globalSandbox) {
        globalSandbox = new SimpleSandbox();
        globalSandbox.init();
    }
    return globalSandbox;
}

// 设置沙箱获取器给快照路由和 AI 路由使用
setSandboxGetter(getGlobalSandbox);
setAISandboxGetter(getGlobalSandbox);

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API文档
app.get('/api', (req, res) => {
    res.json({
        name: 'JS Sandbox Environment Framework',
        version: '1.0.0',
        endpoints: {
            env: {
                'GET /api/env/list': '获取环境代码目录结构',
                'GET /api/env/file?path=': '读取指定环境文件',
                'POST /api/env/file': '写入/更新环境文件',
                'DELETE /api/env/file?path=': '删除AI生成的文件'
            },
            sandbox: {
                'POST /api/sandbox/run': '执行JS代码',
                'POST /api/sandbox/inject': '注入代码',
                'POST /api/sandbox/load-env': '加载环境文件',
                'POST /api/sandbox/reset': '重置沙箱',
                'GET /api/sandbox/status': '获取沙箱状态',
                'GET /api/sandbox/undefined': '获取undefined列表',
                'GET /api/sandbox/logs': '获取所有日志',
                'POST /api/sandbox/logs/clear': '清除日志'
            },
            ai: {
                'GET /api/ai/config': '获取AI配置',
                'POST /api/ai/config': '配置AI平台',
                'POST /api/ai/complete': '生成补环境代码',
                'POST /api/ai/complete-batch': '批量生成',
                'POST /api/ai/apply': '应用AI生成的代码',
                'GET /api/ai/history': '获取AI历史记录',
                'GET /api/ai/history/:id': '获取指定历史',
                'GET /api/ai/summary': '生成Markdown文档',
                'GET /api/ai/docs': '获取Markdown文档'
            },
            snapshot: {
                'POST /api/snapshot/save': '保存快照',
                'POST /api/snapshot/load': '加载快照',
                'GET /api/snapshot/list': '列出所有快照',
                'DELETE /api/snapshot/:name': '删除快照'
            },
            log: {
                'GET /api/log/undefined': '获取undefined日志',
                'GET /api/log/ai-history': '获取AI历史',
                'GET /api/log/list': '列出日志文件',
                'POST /api/log/clear': '清除日志',
                'GET /api/log/export': '导出所有日志'
            },
            mock: {
                'GET /api/mock/rules': '获取所有Mock规则',
                'POST /api/mock/rules': '添加Mock规则',
                'DELETE /api/mock/rules/:id': '删除Mock规则',
                'PATCH /api/mock/rules/:id': '更新Mock规则状态',
                'GET /api/mock/presets': '获取预设模板',
                'POST /api/mock/presets/:name/apply': '应用预设模板',
                'GET /api/mock/inject-code': '生成注入代码'
            }
        }
    });
});

// 前端SPA路由回退
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../web/index.html'));
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

// 启动服务
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     JS逆向沙箱化补环境框架 v1.0.0                            ║
╠════════════════════════════════════════════════════════════╣
║  服务地址: http://localhost:${PORT}                          ║
║  API文档:  http://localhost:${PORT}/api                      ║
║  前端界面: http://localhost:${PORT}                          ║
╚════════════════════════════════════════════════════════════╝
    `);
    
    // 预初始化沙箱
    try {
        console.log('正在初始化沙箱环境...');
        await getGlobalSandbox();
        console.log('沙箱环境初始化完成!');
    } catch (error) {
        console.error('沙箱初始化失败:', error.message);
    }
});

// 优雅关闭
process.on('SIGTERM', async () => {
    console.log('收到SIGTERM信号，正在关闭服务...');
    if (globalSandbox) {
        await globalSandbox.dispose();
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('收到SIGINT信号，正在关闭服务...');
    if (globalSandbox) {
        await globalSandbox.dispose();
    }
    process.exit(0);
});
