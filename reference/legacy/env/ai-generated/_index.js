/**
 * AI生成环境代码汇总入口
 * 
 * 此文件自动加载所有AI生成的补环境代码
 * 每个AI生成的文件都会记录到此处，并按顺序执行
 * 
 * @auto-generated 此文件由系统自动维护
 */

(function() {
    'use strict';
    
    console.log('[AI-Env] Initializing AI-generated environment loader...');
    
    // AI生成的环境文件列表
    // 格式: { filename: '文件名', property: '补充的属性', platform: 'AI平台', timestamp: '生成时间', enabled: true/false }
    const generatedFiles = [// 示例:
        // { filename: 'navigator_webdriver.js', property: 'navigator.webdriver', platform: 'OpenAI', timestamp: '2026-01-02T10:00:00Z', enabled: true },
        { filename: 'navigator_webdriver_1767420862412.js', property: 'navigator.webdriver', platform: 'AI', timestamp: '2026-01-03T06:14:22.413Z', enabled: true },
        { filename: 'navigator_webdriver_1770195441335.js', property: 'navigator.webdriver', platform: 'AI', timestamp: '2026-02-04T08:57:21.335Z' },
        { filename: 'window_userAgent_1770195635546.js', property: 'window.userAgent', platform: 'AI', timestamp: '2026-02-04T09:00:35.548Z' }];
    
    // ==================== AI 文件内容存储 ====================
    // 在 isolated-vm 环境中，我们需要在初始化时注入所有文件内容
    // 这个对象将由 SandboxManager 在加载时填充
    const aiFileContents = window.__aiFileContents__ || {};
    
    // ==================== 加载统计 ====================
    const loadStats = {
        total: 0,
        success: 0,
        failed: 0,
        disabled: 0,
        errors: []
    };
    
    // ==================== 执行 AI 生成的代码 ====================
    function executeAICode(filename, code) {
        try {
            // 创建独立的作用域执行代码
            const wrappedCode = `
                (function() {
                    try {
                        ${code}
                        return { success: true };
                    } catch (error) {
                        return { success: false, error: error.message, stack: error.stack };
                    }
                })();
            `;
            
            const result = eval(wrappedCode);
            
            if (result.success) {
                console.log(`[AI-Env] ✓ Loaded: ${filename}`);
                return { success: true };
            } else {
                console.error(`[AI-Env] ✗ Error in ${filename}:`, result.error);
                return { success: false, error: result.error };
            }
        } catch (error) {
            console.error(`[AI-Env] ✗ Failed to execute ${filename}:`, error.message);
            return { success: false, error: error.message };
        }
    }
    
    // ==================== 加载所有 AI 文件 ====================
    function loadAllAIFiles() {
        console.log(`[AI-Env] Loading ${generatedFiles.length} AI-generated files...`);
        
        loadStats.total = generatedFiles.length;
        
        generatedFiles.forEach(fileInfo => {
            // 检查是否启用
            if (fileInfo.enabled === false) {
                console.log(`[AI-Env] ⊗ Skipped (disabled): ${fileInfo.filename}`);
                loadStats.disabled++;
                return;
            }
            
            // 检查文件内容是否存在
            const code = aiFileContents[fileInfo.filename];
            if (!code) {
                console.warn(`[AI-Env] ⚠ No content for: ${fileInfo.filename}`);
                loadStats.failed++;
                loadStats.errors.push({
                    filename: fileInfo.filename,
                    error: 'File content not found'
                });
                return;
            }
            
            // 执行代码
            const result = executeAICode(fileInfo.filename, code);
            
            if (result.success) {
                loadStats.success++;
            } else {
                loadStats.failed++;
                loadStats.errors.push({
                    filename: fileInfo.filename,
                    error: result.error
                });
            }
        });
        
        // 输出加载统计
        console.log(`[AI-Env] Loading complete: ${loadStats.success} success, ${loadStats.failed} failed, ${loadStats.disabled} disabled`);
        
        if (loadStats.errors.length > 0) {
            console.error('[AI-Env] Errors:', loadStats.errors);
        }
    }
    
    // ==================== 动态添加 AI 文件 ====================
    function addAIFile(fileInfo, code) {
        // 添加到文件列表
        const existing = generatedFiles.findIndex(f => f.filename === fileInfo.filename);
        if (existing >= 0) {
            generatedFiles[existing] = fileInfo;
        } else {
            generatedFiles.push(fileInfo);
        }
        
        // 存储文件内容
        aiFileContents[fileInfo.filename] = code;
        
        // 如果启用，立即执行
        if (fileInfo.enabled !== false) {
            const result = executeAICode(fileInfo.filename, code);
            return result;
        }
        
        return { success: true, skipped: true };
    }
    
    // ==================== 启用/禁用 AI 文件 ====================
    function toggleAIFile(filename, enabled) {
        const file = generatedFiles.find(f => f.filename === filename);
        if (file) {
            file.enabled = enabled;
            console.log(`[AI-Env] ${enabled ? 'Enabled' : 'Disabled'}: ${filename}`);
            return true;
        }
        return false;
    }
    
    // ==================== 获取加载统计 ====================
    function getLoadStats() {
        return {
            ...loadStats,
            files: generatedFiles.map(f => ({
                filename: f.filename,
                property: f.property,
                platform: f.platform,
                enabled: f.enabled !== false
            }))
        };
    }
    
    // ==================== 全局导出 ====================
    window.__aiGeneratedEnv__ = {
        files: generatedFiles,
        fileContents: aiFileContents,
        count: generatedFiles.length,
        loadStats: loadStats,
        
        // 查询方法
        getByProperty: function(prop) {
            return generatedFiles.filter(f => f.property === prop);
        },
        getByPlatform: function(platform) {
            return generatedFiles.filter(f => f.platform === platform);
        },
        getByFilename: function(filename) {
            return generatedFiles.find(f => f.filename === filename);
        },
        
        // 管理方法
        addFile: addAIFile,
        toggleFile: toggleAIFile,
        getStats: getLoadStats,
        
        // 重新加载所有文件
        reload: function() {
            loadStats.success = 0;
            loadStats.failed = 0;
            loadStats.disabled = 0;
            loadStats.errors = [];
            loadAllAIFiles();
        }
    };
    
    // ==================== 自动加载 ====================
    // 如果有文件内容，自动加载所有 AI 文件
    if (Object.keys(aiFileContents).length > 0) {
        loadAllAIFiles();
    } else {
        console.log('[AI-Env] No AI file contents found. Waiting for injection...');
    }
    
    console.log('[AI-Env] Loader initialized. Use window.__aiGeneratedEnv__ to manage AI files.');
})();
