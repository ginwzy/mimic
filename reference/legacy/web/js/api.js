/**
 * API客户端
 */

const API_BASE = '/api';

const api = {
    // ========== 环境管理 ==========
    env: {
        async list() {
            const res = await fetch(`${API_BASE}/env/list`);
            return res.json();
        },
        
        async getFile(path) {
            const res = await fetch(`${API_BASE}/env/file?path=${encodeURIComponent(path)}`);
            return res.json();
        },
        
        async saveFile(path, content) {
            const res = await fetch(`${API_BASE}/env/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content })
            });
            return res.json();
        },
        
        async deleteFile(path) {
            const res = await fetch(`${API_BASE}/env/file?path=${encodeURIComponent(path)}`, {
                method: 'DELETE'
            });
            return res.json();
        }
    },
    
    // ========== 沙箱执行 ==========
    sandbox: {
        async run(code, options = {}) {
            const res = await fetch(`${API_BASE}/sandbox/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, ...options })
            });
            return res.json();
        },
        
        async inject(code) {
            const res = await fetch(`${API_BASE}/sandbox/inject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            return res.json();
        },
        
        async loadEnv(file = null, all = false) {
            const res = await fetch(`${API_BASE}/sandbox/load-env`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file, all })
            });
            return res.json();
        },
        
        async reset() {
            const res = await fetch(`${API_BASE}/sandbox/reset`, {
                method: 'POST'
            });
            return res.json();
        },
        
        async status() {
            const res = await fetch(`${API_BASE}/sandbox/status`);
            return res.json();
        },
        
        async getUndefined() {
            const res = await fetch(`${API_BASE}/sandbox/undefined`);
            return res.json();
        },
        
        async getLogs(type = null, limit = 100) {
            let url = `${API_BASE}/sandbox/logs?limit=${limit}`;
            if (type) url += `&type=${type}`;
            const res = await fetch(url);
            return res.json();
        },
        
        async clearLogs() {
            const res = await fetch(`${API_BASE}/sandbox/logs/clear`, {
                method: 'POST'
            });
            return res.json();
        },
        
        async reloadAI() {
            const res = await fetch(`${API_BASE}/sandbox/reload-ai`, {
                method: 'POST'
            });
            return res.json();
        },
        
        async getEnvironment() {
            const res = await fetch(`${API_BASE}/sandbox/environment`);
            return res.json();
        },
        
        async runFile(filePath) {
            const res = await fetch(`${API_BASE}/sandbox/run-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath })
            });
            return res.json();
        }
    },
    
    // ========== AI补环境 ==========
    ai: {
        async getConfig() {
            const res = await fetch(`${API_BASE}/ai/config`);
            return res.json();
        },
        
        async setConfig(config) {
            const res = await fetch(`${API_BASE}/ai/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            return res.json();
        },
        
        async complete(property, object = 'window', context = '') {
            const res = await fetch(`${API_BASE}/ai/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ property, object, context })
            });
            return res.json();
        },
        
        async completeBatch(properties, object = 'window', context = '') {
            const res = await fetch(`${API_BASE}/ai/complete-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ properties, object, context })
            });
            return res.json();
        },
        
        async apply(historyId = null, filename = null, code = null) {
            const res = await fetch(`${API_BASE}/ai/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ historyId, filename, code })
            });
            return res.json();
        },
        
        async getHistory(options = {}) {
            const params = new URLSearchParams();
            if (options.platform) params.append('platform', options.platform);
            if (options.status) params.append('status', options.status);
            if (options.limit) params.append('limit', options.limit);
            
            const res = await fetch(`${API_BASE}/ai/history?${params}`);
            return res.json();
        },
        
        async getHistoryById(id) {
            const res = await fetch(`${API_BASE}/ai/history/${id}`);
            return res.json();
        },
        
        async getSummary() {
            const res = await fetch(`${API_BASE}/ai/summary`);
            return res.json();
        }
    },
    
    // ========== 快照管理 ==========
    snapshot: {
        async list() {
            const res = await fetch(`${API_BASE}/snapshot/list`);
            return res.json();
        },
        
        async save(name) {
            const res = await fetch(`${API_BASE}/snapshot/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            return res.json();
        },
        
        async load(name) {
            const res = await fetch(`${API_BASE}/snapshot/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            return res.json();
        },
        
        async delete(name) {
            const res = await fetch(`${API_BASE}/snapshot/${name}`, {
                method: 'DELETE'
            });
            return res.json();
        }
    },
    
    // ========== 日志管理 ==========
    log: {
        async getUndefined() {
            const res = await fetch(`${API_BASE}/log/undefined`);
            return res.json();
        },
        
        async getAIHistory() {
            const res = await fetch(`${API_BASE}/log/ai-history`);
            return res.json();
        },
        
        async list() {
            const res = await fetch(`${API_BASE}/log/list`);
            return res.json();
        },
        
        async clear(type = 'all') {
            const res = await fetch(`${API_BASE}/log/clear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            return res.json();
        },
        
        async export() {
            const res = await fetch(`${API_BASE}/log/export`);
            return res.json();
        }
    }
};
