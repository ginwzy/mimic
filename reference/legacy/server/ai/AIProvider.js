/**
 * AI提供者抽象层
 * 支持OpenAI、DeepSeek等多个AI平台
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '../../logs');
const AI_HISTORY_FILE = path.join(LOGS_DIR, 'ai-history.json');

// AI Prompt模板
const PROMPT_TEMPLATE = `你是一个 JS 浏览器环境模拟专家。请为以下缺失的浏览器属性/方法生成补环境代码。

【缺失项】：{property}
【所属对象】：{object}
【上下文】：{context}

【输出要求】：
1. 严格按以下模板输出，不要添加额外解释
2. 代码需兼容 isolated-vm 沙箱环境
3. 使用 IIFE 包裹，避免污染全局
4. 注释必须包含：@env-property、@description、@params（如有）、@returns、@compatibility、@generated-by、@generated-at

【模板】：
/**
 * @env-property {类型} 名称
 * @description 描述
 * @params {类型} 参数名 - 说明
 * @returns {类型} 说明
 * @compatibility 兼容性
 * @generated-by {AI平台}
 * @generated-at {时间}
 */
(function() {
    // 实现代码
})();`;

export class AIProvider {
    constructor(config = {}) {
        this.config = {
            platform: config.platform || 'openai', // 'openai' | 'deepseek'
            apiKey: config.apiKey || process.env.OPENAI_API_KEY,
            baseUrl: config.baseUrl || null,
            model: config.model || null,
            ...config
        };
        
        this.history = this._loadHistory();
    }

    /**
     * 获取平台配置
     */
    _getPlatformConfig() {
        const configs = {
            openai: {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o-mini',
                name: 'OpenAI'
            },
            deepseek: {
                baseUrl: 'https://api.deepseek.com/v1',
                model: 'deepseek-chat',
                name: 'DeepSeek'
            }
        };
        
        return configs[this.config.platform] || configs.openai;
    }

    /**
     * 生成补环境代码
     */
    async generateEnvCode(property, options = {}) {
        const { object = 'window', context = '' } = options;
        
        const prompt = PROMPT_TEMPLATE
            .replace('{property}', property)
            .replace('{object}', object)
            .replace('{context}', context || '无特殊上下文')
            .replace('{AI平台}', this._getPlatformConfig().name)
            .replace('{时间}', new Date().toISOString());

        const platformConfig = this._getPlatformConfig();
        const baseUrl = this.config.baseUrl || platformConfig.baseUrl;
        const model = this.config.model || platformConfig.model;

        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个专业的JavaScript浏览器环境模拟专家，擅长编写高质量的环境补丁代码。'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`API request failed: ${response.status} - ${error}`);
            }

            const data = await response.json();
            const generatedCode = data.choices[0]?.message?.content || '';

            // 提取代码块
            const codeMatch = generatedCode.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
            const code = codeMatch ? codeMatch[1].trim() : generatedCode.trim();

            // 记录历史
            const historyEntry = {
                id: Date.now().toString(),
                property,
                object,
                context,
                platform: this.config.platform,
                model,
                code,
                timestamp: new Date().toISOString(),
                status: 'generated'
            };
            this._addToHistory(historyEntry);

            return {
                success: true,
                code,
                property,
                platform: platformConfig.name,
                model,
                historyId: historyEntry.id
            };
        } catch (error) {
            // 记录失败
            const historyEntry = {
                id: Date.now().toString(),
                property,
                object,
                context,
                platform: this.config.platform,
                error: error.message,
                timestamp: new Date().toISOString(),
                status: 'failed'
            };
            this._addToHistory(historyEntry);

            return {
                success: false,
                error: error.message,
                property,
                platform: this._getPlatformConfig().name
            };
        }
    }

    /**
     * 批量生成补环境代码
     */
    async generateBatch(properties, options = {}) {
        const results = [];
        
        for (const prop of properties) {
            const propConfig = typeof prop === 'string' 
                ? { property: prop } 
                : prop;
            
            const result = await this.generateEnvCode(
                propConfig.property,
                { ...options, ...propConfig }
            );
            results.push(result);
            
            // 避免请求过快
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return results;
    }

    /**
     * 加载历史记录
     */
    _loadHistory() {
        try {
            if (fs.existsSync(AI_HISTORY_FILE)) {
                return JSON.parse(fs.readFileSync(AI_HISTORY_FILE, 'utf-8'));
            }
        } catch (e) {
            console.error('Failed to load AI history:', e);
        }
        return [];
    }

    /**
     * 添加到历史记录
     */
    _addToHistory(entry) {
        this.history.push(entry);
        
        // 限制历史记录数量
        if (this.history.length > 1000) {
            this.history = this.history.slice(-1000);
        }
        
        this._saveHistory();
    }

    /**
     * 保存历史记录
     */
    _saveHistory() {
        try {
            if (!fs.existsSync(LOGS_DIR)) {
                fs.mkdirSync(LOGS_DIR, { recursive: true });
            }
            fs.writeFileSync(AI_HISTORY_FILE, JSON.stringify(this.history, null, 2));
        } catch (e) {
            console.error('Failed to save AI history:', e);
        }
    }

    /**
     * 获取历史记录
     */
    getHistory(options = {}) {
        let filtered = [...this.history];
        
        if (options.platform) {
            filtered = filtered.filter(h => h.platform === options.platform);
        }
        if (options.status) {
            filtered = filtered.filter(h => h.status === options.status);
        }
        if (options.property) {
            filtered = filtered.filter(h => h.property.includes(options.property));
        }
        if (options.limit) {
            filtered = filtered.slice(-options.limit);
        }
        
        return filtered;
    }

    /**
     * 获取指定历史记录
     */
    getHistoryById(id) {
        return this.history.find(h => h.id === id);
    }

    /**
     * 更新历史记录状态
     */
    updateHistoryStatus(id, status, additionalData = {}) {
        const entry = this.history.find(h => h.id === id);
        if (entry) {
            entry.status = status;
            Object.assign(entry, additionalData);
            this._saveHistory();
            return true;
        }
        return false;
    }

    /**
     * 生成AI补全Markdown文档
     */
    generateMarkdownDoc() {
        const successHistory = this.history.filter(h => h.status === 'applied');
        
        let markdown = `# AI补环境汇总文档

> 生成时间: ${new Date().toISOString()}
> 总计补充: ${successHistory.length} 项

## 补充项列表

| 属性/方法 | 所属对象 | AI平台 | 生成时间 |
|----------|---------|--------|---------|
`;

        successHistory.forEach(entry => {
            markdown += `| ${entry.property} | ${entry.object || 'window'} | ${entry.platform} | ${entry.timestamp} |\n`;
        });

        markdown += `\n## 详细代码\n\n`;

        successHistory.forEach(entry => {
            markdown += `### ${entry.property}

**生成平台**: ${entry.platform}  
**生成时间**: ${entry.timestamp}  
**所属对象**: ${entry.object || 'window'}

\`\`\`javascript
${entry.code}
\`\`\`

---

`;
        });

        return markdown;
    }

    /**
     * 切换平台
     */
    setPlatform(platform, apiKey = null) {
        this.config.platform = platform;
        if (apiKey) {
            this.config.apiKey = apiKey;
        }
    }
}

export default AIProvider;
