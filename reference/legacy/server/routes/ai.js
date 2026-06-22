/**
 * AI补环境路由
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AIProvider } from '../ai/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_DIR = path.join(__dirname, '../../env');
const AI_GEN_DIR = path.join(ENV_DIR, 'ai-generated');
const DOCS_DIR = path.join(__dirname, '../../docs');

const router = express.Router();

// AI提供者实例
let aiProvider = null;

// 沙箱实例获取器（从 server/index.js 注入）
let getSandboxInstance = null;

export function setSandboxGetter(getter) {
    getSandboxInstance = getter;
}

/**
 * 获取AI提供者实例
 */
function getAIProvider(config = {}) {
    if (!aiProvider || config.platform || config.apiKey) {
        aiProvider = new AIProvider(config);
    }
    return aiProvider;
}

/**
 * 配置AI平台
 * POST /ai/config
 * Body: { platform: 'openai', apiKey: '...', baseUrl: '...', model: '...' }
 */
router.post('/config', (req, res) => {
    const { platform, apiKey, baseUrl, model } = req.body;
    
    try {
        aiProvider = new AIProvider({
            platform: platform || 'openai',
            apiKey: apiKey || process.env.OPENAI_API_KEY,
            baseUrl,
            model
        });
        
        res.json({
            success: true,
            message: 'AI configuration updated',
            config: {
                platform: aiProvider.config.platform,
                hasApiKey: !!aiProvider.config.apiKey,
                model: aiProvider.config.model
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
 * 获取当前AI配置
 * GET /ai/config
 */
router.get('/config', (req, res) => {
    const provider = getAIProvider();
    res.json({
        success: true,
        data: {
            platform: provider.config.platform,
            hasApiKey: !!provider.config.apiKey,
            model: provider.config.model,
            baseUrl: provider.config.baseUrl
        }
    });
});

/**
 * 生成补环境代码
 * POST /ai/complete
 * Body: { property: 'navigator.webdriver', object: 'window', context: '...' }
 */
router.post('/complete', async (req, res) => {
    const { property, object = 'window', context = '' } = req.body;
    
    if (!property) {
        return res.status(400).json({
            success: false,
            error: 'Missing property parameter'
        });
    }

    try {
        const provider = getAIProvider();
        const result = await provider.generateEnvCode(property, { object, context });
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 批量生成补环境代码
 * POST /ai/complete-batch
 * Body: { properties: ['navigator.webdriver', 'window.chrome'], object: 'window' }
 */
router.post('/complete-batch', async (req, res) => {
    const { properties, object = 'window', context = '' } = req.body;
    
    if (!properties || !Array.isArray(properties) || properties.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Missing or invalid properties parameter'
        });
    }

    try {
        const provider = getAIProvider();
        const results = await provider.generateBatch(properties, { object, context });
        
        res.json({
            success: true,
            results,
            total: results.length,
            successful: results.filter(r => r.success).length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 应用AI生成的代码
 * POST /ai/apply
 * Body: { historyId: '...', filename: 'navigator_webdriver.js', autoReload: true }
 */
router.post('/apply', async (req, res) => {
    const { historyId, filename, code, autoReload = true } = req.body;
    
    let codeToApply = code;
    let property = 'unknown';
    
    // 如果提供了historyId，从历史记录获取代码
    if (historyId) {
        const provider = getAIProvider();
        const historyEntry = provider.getHistoryById(historyId);
        
        if (!historyEntry) {
            return res.status(404).json({
                success: false,
                error: 'History entry not found'
            });
        }
        
        codeToApply = historyEntry.code;
        property = historyEntry.property;
    }
    
    if (!codeToApply) {
        return res.status(400).json({
            success: false,
            error: 'Missing code or historyId'
        });
    }

    // 生成文件名
    const safeFilename = filename || `${property.replace(/\./g, '_')}_${Date.now()}.js`;
    const filePath = path.join(AI_GEN_DIR, safeFilename);

    try {
        // 确保目录存在
        if (!fs.existsSync(AI_GEN_DIR)) {
            fs.mkdirSync(AI_GEN_DIR, { recursive: true });
        }

        // 写入文件
        fs.writeFileSync(filePath, codeToApply, 'utf-8');

        // 更新索引文件
        await updateAIGeneratedIndex(safeFilename, property);

        // 更新历史记录状态
        if (historyId) {
            const provider = getAIProvider();
            provider.updateHistoryStatus(historyId, 'applied', {
                appliedFilename: safeFilename,
                appliedAt: new Date().toISOString()
            });
        }

        // 自动重载 AI 生成的文件
        let reloadResult = null;
        if (autoReload && getSandboxInstance) {
            try {
                const sandbox = await getSandboxInstance();
                reloadResult = await sandbox.reloadAIGeneratedFiles();
            } catch (reloadError) {
                console.error('[AI Apply] Failed to reload AI files:', reloadError);
                // 不阻塞主流程，只记录错误
                reloadResult = {
                    success: false,
                    error: reloadError.message
                };
            }
        }

        res.json({
            success: true,
            message: 'Code applied successfully',
            filename: safeFilename,
            path: `ai-generated/${safeFilename}`,
            reloaded: autoReload,
            reloadResult: reloadResult
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 更新AI生成索引文件
 */
async function updateAIGeneratedIndex(filename, property) {
    const indexPath = path.join(AI_GEN_DIR, '_index.js');
    
    // 读取现有索引
    let indexContent = fs.existsSync(indexPath) 
        ? fs.readFileSync(indexPath, 'utf-8')
        : '';
    
    // 查找generatedFiles数组
    const arrayMatch = indexContent.match(/const generatedFiles = \[([\s\S]*?)\];/);
    
    if (arrayMatch) {
        // 添加新条目
        const newEntry = `        { filename: '${filename}', property: '${property}', platform: 'AI', timestamp: '${new Date().toISOString()}' }`;
        
        let arrayContent = arrayMatch[1].trim();
        if (arrayContent) {
            arrayContent += ',\n' + newEntry;
        } else {
            arrayContent = '\n' + newEntry + '\n    ';
        }
        
        indexContent = indexContent.replace(
            /const generatedFiles = \[([\s\S]*?)\];/,
            `const generatedFiles = [${arrayContent}];`
        );
        
        fs.writeFileSync(indexPath, indexContent, 'utf-8');
    }
}

/**
 * 获取AI补充历史
 * GET /ai/history
 * Query: { platform, status, limit }
 */
router.get('/history', (req, res) => {
    const { platform, status, property, limit } = req.query;
    
    try {
        const provider = getAIProvider();
        const history = provider.getHistory({
            platform,
            status,
            property,
            limit: limit ? parseInt(limit) : undefined
        });
        
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
 * 获取指定历史记录
 * GET /ai/history/:id
 */
router.get('/history/:id', (req, res) => {
    const { id } = req.params;
    
    try {
        const provider = getAIProvider();
        const entry = provider.getHistoryById(id);
        
        if (!entry) {
            return res.status(404).json({
                success: false,
                error: 'History entry not found'
            });
        }
        
        res.json({
            success: true,
            data: entry
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 生成AI补全汇总文档
 * GET /ai/summary
 */
router.get('/summary', (req, res) => {
    try {
        const provider = getAIProvider();
        const markdown = provider.generateMarkdownDoc();
        
        // 保存到文件
        if (!fs.existsSync(DOCS_DIR)) {
            fs.mkdirSync(DOCS_DIR, { recursive: true });
        }
        
        const docPath = path.join(DOCS_DIR, 'ai-summary.md');
        fs.writeFileSync(docPath, markdown, 'utf-8');
        
        res.json({
            success: true,
            data: {
                markdown,
                path: 'docs/ai-summary.md'
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
 * 获取AI补全文档
 * GET /ai/docs
 */
router.get('/docs', (req, res) => {
    const docPath = path.join(DOCS_DIR, 'ai-summary.md');
    
    if (!fs.existsSync(docPath)) {
        return res.status(404).json({
            success: false,
            error: 'Document not found. Generate it first using GET /ai/summary'
        });
    }
    
    try {
        const content = fs.readFileSync(docPath, 'utf-8');
        res.type('text/markdown').send(content);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
