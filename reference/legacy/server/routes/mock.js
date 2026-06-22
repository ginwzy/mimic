/**
 * Mock配置路由
 * 管理运行时的mock规则
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_CONFIG_PATH = path.join(__dirname, '../../config/mock-rules.json');

const router = express.Router();

// 确保配置目录存在
const configDir = path.dirname(MOCK_CONFIG_PATH);
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

// 初始化默认配置
if (!fs.existsSync(MOCK_CONFIG_PATH)) {
    fs.writeFileSync(MOCK_CONFIG_PATH, JSON.stringify({
        rules: [],
        presets: {
            'anti-detect': [
                { path: 'navigator.webdriver', type: 'property', value: 'undefined' },
                { path: 'navigator.languages', type: 'property', value: '["zh-CN", "zh", "en"]' },
                { path: 'navigator.plugins.length', type: 'property', value: '3' },
                { path: 'window.chrome', type: 'property', value: '{ runtime: {} }' },
                { path: 'window.outerWidth', type: 'property', value: '1920' },
                { path: 'window.outerHeight', type: 'property', value: '1080' }
            ],
            'canvas-fp': [
                { path: 'HTMLCanvasElement.prototype.toDataURL', type: 'method', value: '() => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="' },
                { path: 'CanvasRenderingContext2D.prototype.getImageData', type: 'method', value: '() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })' }
            ],
            'webgl-fp': [
                { path: 'WebGLRenderingContext.prototype.getParameter', type: 'method', value: '(pname) => { const params = { 37445: "Intel Inc.", 37446: "Intel Iris OpenGL Engine" }; return params[pname] || null; }' },
                { path: 'WebGLRenderingContext.prototype.getSupportedExtensions', type: 'method', value: '() => ["WEBGL_debug_renderer_info"]' }
            ],
            'audio-fp': [
                { path: 'AudioContext.prototype.createOscillator', type: 'method', value: '() => ({ connect: () => {}, start: () => {}, frequency: { value: 440 } })' },
                { path: 'AudioContext.prototype.createDynamicsCompressor', type: 'method', value: '() => ({ connect: () => {}, threshold: { value: -50 }, knee: { value: 40 }, ratio: { value: 12 }, reduction: { value: -20 }, attack: { value: 0 }, release: { value: 0.25 } })' }
            ]
        }
    }, null, 2));
}

// 读取配置
function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(MOCK_CONFIG_PATH, 'utf-8'));
    } catch (e) {
        return { rules: [], presets: {} };
    }
}

// 保存配置
function saveConfig(config) {
    fs.writeFileSync(MOCK_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * 获取所有mock规则
 */
router.get('/rules', (req, res) => {
    const config = readConfig();
    res.json({
        success: true,
        data: {
            rules: config.rules,
            count: config.rules.length
        }
    });
});

/**
 * 添加mock规则
 */
router.post('/rules', (req, res) => {
    const { path: mockPath, type, value, condition, description } = req.body;
    
    if (!mockPath) {
        return res.status(400).json({ success: false, error: 'path is required' });
    }
    
    const config = readConfig();
    
    // 检查是否已存在
    const existingIndex = config.rules.findIndex(r => r.path === mockPath);
    if (existingIndex >= 0) {
        // 更新现有规则
        config.rules[existingIndex] = {
            id: config.rules[existingIndex].id,
            path: mockPath,
            type: type || 'property',
            value: value,
            condition: condition,
            description: description,
            enabled: true,
            callCount: config.rules[existingIndex].callCount || 0,
            updatedAt: new Date().toISOString()
        };
    } else {
        // 添加新规则
        config.rules.push({
            id: 'mock_' + Date.now(),
            path: mockPath,
            type: type || 'property',
            value: value,
            condition: condition,
            description: description,
            enabled: true,
            callCount: 0,
            createdAt: new Date().toISOString()
        });
    }
    
    saveConfig(config);
    
    res.json({
        success: true,
        message: existingIndex >= 0 ? 'Mock规则已更新' : 'Mock规则已添加'
    });
});

/**
 * 删除mock规则
 */
router.delete('/rules/:id', (req, res) => {
    const { id } = req.params;
    const config = readConfig();
    
    const index = config.rules.findIndex(r => r.id === id);
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
    }
    
    config.rules.splice(index, 1);
    saveConfig(config);
    
    res.json({ success: true, message: 'Mock规则已删除' });
});

/**
 * 更新mock规则状态
 */
router.patch('/rules/:id', (req, res) => {
    const { id } = req.params;
    const { enabled, value, description } = req.body;
    
    const config = readConfig();
    const rule = config.rules.find(r => r.id === id);
    
    if (!rule) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
    }
    
    if (enabled !== undefined) rule.enabled = enabled;
    if (value !== undefined) rule.value = value;
    if (description !== undefined) rule.description = description;
    rule.updatedAt = new Date().toISOString();
    
    saveConfig(config);
    
    res.json({ success: true, message: 'Mock规则已更新' });
});

/**
 * 获取预设模板列表
 */
router.get('/presets', (req, res) => {
    const config = readConfig();
    
    const presetList = Object.entries(config.presets).map(([name, rules]) => ({
        name,
        ruleCount: rules.length,
        rules: rules
    }));
    
    res.json({
        success: true,
        data: presetList
    });
});

/**
 * 应用预设模板
 */
router.post('/presets/:name/apply', (req, res) => {
    const { name } = req.params;
    const config = readConfig();
    
    if (!config.presets[name]) {
        return res.status(404).json({ success: false, error: 'Preset not found' });
    }
    
    const presetRules = config.presets[name];
    let addedCount = 0;
    let updatedCount = 0;
    
    for (const presetRule of presetRules) {
        const existingIndex = config.rules.findIndex(r => r.path === presetRule.path);
        
        if (existingIndex >= 0) {
            // 更新
            config.rules[existingIndex] = {
                ...config.rules[existingIndex],
                ...presetRule,
                enabled: true,
                updatedAt: new Date().toISOString()
            };
            updatedCount++;
        } else {
            // 添加
            config.rules.push({
                id: 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                ...presetRule,
                enabled: true,
                callCount: 0,
                createdAt: new Date().toISOString()
            });
            addedCount++;
        }
    }
    
    saveConfig(config);
    
    res.json({
        success: true,
        message: `预设"${name}"已应用`,
        added: addedCount,
        updated: updatedCount
    });
});

/**
 * 清空所有mock规则
 */
router.delete('/rules', (req, res) => {
    const config = readConfig();
    config.rules = [];
    saveConfig(config);
    
    res.json({ success: true, message: '所有Mock规则已清空' });
});

/**
 * 导出mock配置
 */
router.get('/export', (req, res) => {
    const config = readConfig();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=mock-rules.json');
    res.json(config);
});

/**
 * 导入mock配置
 */
router.post('/import', (req, res) => {
    const { rules, merge } = req.body;
    
    if (!Array.isArray(rules)) {
        return res.status(400).json({ success: false, error: 'rules must be an array' });
    }
    
    const config = readConfig();
    
    if (merge) {
        // 合并模式
        for (const rule of rules) {
            const existingIndex = config.rules.findIndex(r => r.path === rule.path);
            if (existingIndex === -1) {
                config.rules.push({
                    ...rule,
                    id: rule.id || 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    createdAt: rule.createdAt || new Date().toISOString()
                });
            }
        }
    } else {
        // 替换模式
        config.rules = rules.map(rule => ({
            ...rule,
            id: rule.id || 'mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            createdAt: rule.createdAt || new Date().toISOString()
        }));
    }
    
    saveConfig(config);
    
    res.json({
        success: true,
        message: `已${merge ? '合并' : '导入'}${rules.length}条Mock规则`
    });
});

/**
 * 生成注入沙箱的mock代码
 */
router.get('/inject-code', (req, res) => {
    const config = readConfig();
    const enabledRules = config.rules.filter(r => r.enabled);
    
    if (enabledRules.length === 0) {
        return res.json({
            success: true,
            code: '// No mock rules enabled'
        });
    }
    
    let code = `
// ==================== Auto-generated Mock Injection Code ====================
// Generated at: ${new Date().toISOString()}
// Total rules: ${enabledRules.length}

(function() {
    'use strict';
    
    const Monitor = window.__EnvMonitor__ || { setMock: function() {} };
    
`;
    
    for (const rule of enabledRules) {
        const { path: mockPath, type, value } = rule;
        
        if (type === 'property') {
            code += `    // Mock: ${mockPath} (property)\n`;
            code += `    Monitor.setMock('property', '${mockPath}', ${value});\n\n`;
        } else if (type === 'method') {
            code += `    // Mock: ${mockPath} (method)\n`;
            code += `    Monitor.setMock('method', '${mockPath}', ${value});\n\n`;
        } else if (type === 'returnValue') {
            code += `    // Mock: ${mockPath} (returnValue)\n`;
            code += `    Monitor.setMock('returnValue', '${mockPath}', ${value});\n\n`;
        }
    }
    
    code += `
    console.log('[Mock] Injected ${enabledRules.length} mock rules');
})();
`;
    
    res.json({
        success: true,
        code: code,
        ruleCount: enabledRules.length
    });
});

export default router;
