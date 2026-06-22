/**
 * 前端应用主逻辑
 */

// ========== 全局状态 ==========
let currentFile = null;
let currentAIResult = null;
let codeEditor = null;
let envEditor = null;

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initTabs();
    initCodeEditors();
    setupFileRunner();
    
    // 初始加载数据
    loadSandboxStatus();
    refreshUndefinedCount();
    refreshEnvTree();
    loadAIConfig();
    loadSnapshots();
    loadAIHistory();
});

// ========== 导航 ==========
function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            
            // 更新导航状态
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // 切换页面
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`page-${page}`).classList.add('active');
            
            // 页面特定初始化
            if (page === 'undefined') refreshUndefinedList();
            if (page === 'logs') loadLogs();
            if (page === 'ai') loadAIHistory();
        });
    });
}

// ========== Tab切换 ==========
function initTabs() {
    // 结果面板Tab
    document.querySelectorAll('.result-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            document.querySelectorAll('.result-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.result-panel .tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`tab-${tab}`).classList.add('active');
        });
    });
    
    // 日志Tab
    document.querySelectorAll('.log-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.logTab;
            
            document.querySelectorAll('.log-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.log-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`log-${tab}`).classList.add('active');
        });
    });
}

// ========== 代码编辑器初始化 ==========
function initCodeEditors() {
    // 使用简单的textarea，如需要可替换为CodeMirror
}

// ========== Toast通知 ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========== 模态框 ==========
function openModal(title, content, footer = '') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = content;
    document.getElementById('modal-footer').innerHTML = footer;
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

// ========== 沙箱状态 ==========
async function loadSandboxStatus() {
    try {
        const result = await api.sandbox.status();
        if (result.success) {
            document.getElementById('sandbox-status').textContent = `沙箱就绪 (${result.data.type})`;
            document.querySelector('.status-indicator .dot').style.background = 'var(--success-color)';
            
            // 显示环境信息
            if (result.data.environment) {
                const envInfo = result.data.environment;
                console.log('环境信息:', envInfo);
            }
        }
    } catch (error) {
        document.getElementById('sandbox-status').textContent = '沙箱异常';
        document.querySelector('.status-indicator .dot').style.background = 'var(--danger-color)';
    }
}

// ========== 文件选择运行 ==========
function setupFileRunner() {
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const code = e.target.result;
                    document.getElementById('code-input').value = code;
                    showToast(`已加载文件: ${file.name}`, 'success');
                };
                reader.readAsText(file);
            }
        });
    }
}

// 查看环境信息
async function viewEnvironmentInfo() {
    try {
        const result = await api.sandbox.getEnvironment();
        if (result.success) {
            openModal(
                '沙箱环境信息',
                `<pre style="background: var(--bg-color); padding: 16px; border-radius: 8px; overflow: auto; max-height: 500px;">${JSON.stringify(result.data, null, 2)}</pre>`
            );
        }
    } catch (error) {
        showToast(`获取环境信息失败: ${error.message}`, 'error');
    }
}

// 查看访问日志
async function viewAccessLogs() {
    try {
        const result = await api.sandbox.getLogs('access', 100);
        if (result.success) {
            const logs = result.data.access || [];
            openModal(
                '访问日志',
                logs.length > 0 ? 
                    `<div style="max-height: 500px; overflow: auto;">${logs.map(log => 
                        `<div style="padding: 8px; border-bottom: 1px solid var(--border-color);">
                            <strong>${log.path}</strong><br>
                            <span style="color: var(--text-secondary);">值: ${log.value}</span><br>
                            <span style="color: var(--text-secondary); font-size: 12px;">
                                时间: ${new Date(log.timestamp).toLocaleString()}
                            </span>
                        </div>`
                    ).join('')}</div>` :
                    '<p style="text-align: center; color: var(--text-secondary);">暂无访问日志</p>'
            );
        }
    } catch (error) {
        showToast(`获取日志失败: ${error.message}`, 'error');
    }
}

// 显示详细日志
function showDetailedLogs() {
    const logs = window.__lastExecutionLogs__;
    
    if (!logs) {
        showToast('暂无日志数据', 'info');
        return;
    }
    
    const accessHtml = logs.access.map((log, i) => `
        <div style="padding: 8px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
            <span style="color: var(--primary-color);">${i + 1}.</span>
            <strong>${log.path}</strong>
            <span style="color: var(--text-secondary);"> → ${log.type}</span>
        </div>
    `).join('');
    
    const callHtml = logs.call.length > 0 ? logs.call.map((log, i) => `
        <div style="padding: 8px; border-bottom: 1px solid var(--border-color); font-size: 13px;">
            <span style="color: var(--success-color);">${i + 1}.</span>
            <strong>${log.path}</strong>
            <span style="color: var(--text-secondary);"> (${log.argTypes?.join(', ') || ''})</span>
        </div>
    `).join('') : '<p style="text-align: center; color: var(--text-secondary); padding: 16px;">无方法调用</p>';
    
    openModal(
        '详细执行日志',
        `
        <div style="max-height: 500px; overflow: auto;">
            <h4 style="margin-top: 0;">📝 属性访问 (${logs.access.length})</h4>
            ${accessHtml || '<p style="text-align: center; color: var(--text-secondary);">无访问记录</p>'}
            
            <h4 style="margin-top: 24px;">🔧 方法调用 (${logs.call.length})</h4>
            ${callHtml}
        </div>
        `
    );
}

// ========== 代码搜索 ==========
async function searchCode() {
    const keyword = document.getElementById('code-search').value.trim();
    if (!keyword) {
        showToast('请输入搜索关键词', 'warning');
        return;
    }
    
    try {
        // 搜索所有环境文件
        const result = await api.env.list();
        if (!result.success) {
            showToast('搜索失败', 'error');
            return;
        }
        
        const searchResults = [];
        
        // 递归搜索文件
        async function searchInTree(items) {
            for (const item of items) {
                if (item.type === 'file') {
                    const fileResult = await api.env.getFile(item.path);
                    if (fileResult.success && fileResult.data.content.includes(keyword)) {
                        // 找到匹配的行
                        const lines = fileResult.data.content.split('\n');
                        const matches = lines
                            .map((line, index) => ({ line, lineNum: index + 1 }))
                            .filter(({ line }) => line.includes(keyword));
                        
                        searchResults.push({
                            file: item.path,
                            matches: matches.slice(0, 3) // 只显示前3个匹配
                        });
                    }
                } else if (item.children) {
                    await searchInTree(item.children);
                }
            }
        }
        
        await searchInTree(result.data);
        
        // 显示结果
        const resultsDiv = document.getElementById('search-results');
        const resultsList = document.getElementById('search-results-list');
        
        if (searchResults.length > 0) {
            resultsList.innerHTML = searchResults.map(r => `
                <div class="search-result-item" style="margin-bottom: 16px; padding: 12px; background: var(--bg-color); border-radius: 8px;">
                    <div style="font-weight: bold; margin-bottom: 8px;">
                        <i class="fas fa-file-code"></i> ${r.file}
                    </div>
                    ${r.matches.map(m => `
                        <div style="font-size: 12px; color: var(--text-secondary); margin-left: 20px;">
                            <span style="color: var(--primary-color);">行${m.lineNum}:</span> ${m.line.trim().substring(0, 80)}
                        </div>
                    `).join('')}
                    <button class="btn btn-sm btn-primary" onclick="loadEnvFile('${r.file}')" style="margin-top: 8px;">
                        <i class="fas fa-eye"></i> 查看文件
                    </button>
                </div>
            `).join('');
            resultsDiv.style.display = 'block';
            showToast(`找到 ${searchResults.length} 个文件包含 "${keyword}"`, 'success');
        } else {
            resultsDiv.style.display = 'none';
            showToast(`未找到包含 "${keyword}" 的文件`, 'info');
        }
    } catch (error) {
        showToast(`搜索失败: ${error.message}`, 'error');
    }
}

// ========== 沙箱执行 ==========
async function executeCode() {
    const code = document.getElementById('code-input').value;
    if (!code.trim()) {
        showToast('请输入代码', 'warning');
        return;
    }
    
    const reset = document.getElementById('auto-reset').checked;
    
    try {
        showToast('正在执行...', 'info');
        const result = await api.sandbox.run(code, { reset });
        
        // 显示结果
        const execResult = document.getElementById('exec-result');
        if (result.success) {
            execResult.textContent = result.result || '(无返回值)';
            execResult.style.color = 'var(--success-color)';
        } else {
            execResult.textContent = `错误: ${result.error}\n\n${result.stack || ''}`;
            execResult.style.color = 'var(--danger-color)';
        }
        
        // 显示执行时间
        document.getElementById('exec-time').textContent = `耗时: ${result.duration}ms`;
        
        // 显示undefined列表
        const undefinedList = document.getElementById('undefined-list');
        if (result.undefinedPaths && result.undefinedPaths.length > 0) {
            undefinedList.innerHTML = result.undefinedPaths.map(path => `
                <div class="log-entry">
                    <span class="path">${path}</span>
                </div>
            `).join('');
        } else {
            undefinedList.innerHTML = '<div class="empty-state"><p>无未定义属性</p></div>';
        }
        
        // 显示console输出
        const consoleOutput = document.getElementById('console-output');
        if (result.consoleOutput && result.consoleOutput.length > 0) {
            consoleOutput.textContent = result.consoleOutput
                .map(([type, ...args]) => `[${type}] ${args.join(' ')}`)
                .join('\n');
        } else {
            consoleOutput.textContent = '(无控制台输出)';
        }
        
        // 显示执行统计
        if (result.stats) {
            console.log('📊 执行统计:', result.stats);
        }
        
        // 显示访问日志到界面
        if (result.accessLogs && result.accessLogs.length > 0) {
            console.log('📝 属性访问日志 (' + result.accessLogs.length + ' 条):', result.accessLogs);
            
            // 在结果面板显示统计
            const statsHtml = `
                <div style="margin-top: 16px; padding: 12px; background: var(--bg-color); border-radius: 8px;">
                    <strong>📊 日志统计:</strong><br>
                    属性访问: ${result.stats.accessCount} 次 | 
                    方法调用: ${result.stats.callCount} 次 | 
                    控制台: ${result.stats.consoleCount} 条
                    <br>
                    <button class="btn btn-sm btn-primary" onclick="showDetailedLogs()" style="margin-top: 8px;">
                        <i class="fas fa-list"></i> 查看详细日志
                    </button>
                </div>
            `;
            
            const execResult = document.getElementById('exec-result');
            if (execResult.nextElementSibling) {
                execResult.nextElementSibling.remove();
            }
            execResult.insertAdjacentHTML('afterend', statsHtml);
            
            // 保存日志数据供查看
            window.__lastExecutionLogs__ = {
                access: result.accessLogs,
                call: result.callLogs
            };
        }
        
        // 显示调用日志
        if (result.callLogs && result.callLogs.length > 0) {
            console.log('🔧 方法调用日志 (' + result.callLogs.length + ' 条):', result.callLogs);
        }
        
        // 更新undefined计数
        refreshUndefinedCount();
        
        showToast(result.success ? '执行成功' : '执行失败', result.success ? 'success' : 'error');
    } catch (error) {
        showToast(`执行错误: ${error.message}`, 'error');
    }
}

async function resetSandbox() {
    try {
        await api.sandbox.reset();
        showToast('沙箱已重置', 'success');
        loadSandboxStatus();
    } catch (error) {
        showToast(`重置失败: ${error.message}`, 'error');
    }
}

function formatCode() {
    const input = document.getElementById('code-input');
    try {
        // 简单格式化（实际项目可用prettier）
        const code = input.value;
        // 这里只做简单处理
        input.value = code.trim();
    } catch (error) {
        showToast('格式化失败', 'error');
    }
}

function clearCode() {
    document.getElementById('code-input').value = '';
    document.getElementById('exec-result').textContent = '';
    document.getElementById('exec-time').textContent = '';
}

// ========== 环境管理 ==========
async function refreshEnvTree() {
    try {
        const result = await api.env.list();
        if (result.success) {
            const tree = document.getElementById('env-tree');
            tree.innerHTML = renderTree(result.data);
        }
    } catch (error) {
        showToast(`加载环境目录失败: ${error.message}`, 'error');
    }
}

function renderTree(items, level = 0) {
    return items.map(item => {
        if (item.type === 'directory') {
            return `
                <div class="tree-folder">
                    <div class="tree-item folder" onclick="toggleFolder(this)">
                        <i class="fas fa-folder"></i>
                        <span>${item.name}</span>
                    </div>
                    <div class="tree-children">${renderTree(item.children, level + 1)}</div>
                </div>
            `;
        } else {
            return `
                <div class="tree-item file" onclick="loadEnvFile('${item.path}')" data-path="${item.path}">
                    <i class="fas fa-file-code"></i>
                    <span>${item.name}</span>
                </div>
            `;
        }
    }).join('');
}

function toggleFolder(element) {
    const children = element.nextElementSibling;
    const icon = element.querySelector('i');
    
    if (children.style.display === 'none') {
        children.style.display = 'block';
        icon.classList.replace('fa-folder', 'fa-folder-open');
    } else {
        children.style.display = 'none';
        icon.classList.replace('fa-folder-open', 'fa-folder');
    }
}

async function loadEnvFile(path) {
    try {
        const result = await api.env.getFile(path);
        if (result.success) {
            currentFile = path;
            document.getElementById('current-file-path').textContent = path;
            document.getElementById('env-editor').value = result.data.content;
            document.getElementById('save-btn').disabled = false;
            
            // 高亮当前文件
            document.querySelectorAll('#env-tree .tree-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-path="${path}"]`)?.classList.add('active');
        }
    } catch (error) {
        showToast(`加载文件失败: ${error.message}`, 'error');
    }
}

async function saveEnvFile() {
    if (!currentFile) return;
    
    const content = document.getElementById('env-editor').value;
    
    try {
        const result = await api.env.saveFile(currentFile, content);
        if (result.success) {
            showToast('文件已保存', 'success');
        } else {
            showToast(`保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`保存失败: ${error.message}`, 'error');
    }
}

// ========== Undefined监控 ==========
async function refreshUndefinedCount() {
    try {
        const result = await api.sandbox.getUndefined();
        if (result.success) {
            document.getElementById('undefined-count').textContent = result.total || 0;
        }
    } catch (error) {
        console.error('获取undefined计数失败:', error);
    }
}

async function refreshUndefinedList() {
    try {
        const result = await api.sandbox.getUndefined();
        const tbody = document.getElementById('undefined-table-body');
        const emptyState = document.getElementById('no-undefined');
        
        if (result.success && result.data.length > 0) {
            tbody.innerHTML = result.data.map(item => `
                <tr>
                    <td><input type="checkbox" class="undefined-check" data-path="${item.path}"></td>
                    <td><code>${item.path}</code></td>
                    <td>${item.context || '-'}</td>
                    <td>${item.timestamp ? new Date(item.timestamp).toLocaleString() : '-'}</td>
                    <td><span class="status-badge ${item.fixed ? 'fixed' : 'unfixed'}">${item.fixed ? '已修复' : '未修复'}</span></td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="aiCompleteProperty('${item.path}')">
                            <i class="fas fa-magic"></i> AI补充
                        </button>
                    </td>
                </tr>
            `).join('');
            emptyState.style.display = 'none';
        } else {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
        }
        
        document.getElementById('undefined-count').textContent = result.total || 0;
    } catch (error) {
        showToast(`加载undefined列表失败: ${error.message}`, 'error');
    }
}

async function aiCompleteProperty(property) {
    // 切换到AI页面并填充属性
    document.querySelector('[data-page="ai"]').click();
    document.getElementById('ai-property').value = property;
    
    // 解析对象
    const parts = property.split('.');
    if (parts.length > 1) {
        parts.pop();
        document.getElementById('ai-object').value = parts.join('.');
    }
}

async function autoCompleteAll() {
    const checkboxes = document.querySelectorAll('.undefined-check:checked');
    if (checkboxes.length === 0) {
        showToast('请先选择要补充的属性', 'warning');
        return;
    }
    
    const properties = Array.from(checkboxes).map(cb => cb.dataset.path);
    
    showToast(`开始批量补充 ${properties.length} 个属性...`, 'info');
    
    try {
        const result = await api.ai.completeBatch(properties);
        if (result.success) {
            showToast(`批量生成完成: ${result.successful}/${result.total} 成功`, 'success');
            
            // 询问是否立即应用所有生成的代码
            if (result.successful > 0 && confirm(`成功生成 ${result.successful} 个补充代码，是否立即应用？`)) {
                showToast('正在批量应用代码...', 'info');
                
                let appliedCount = 0;
                let failedCount = 0;
                
                // 逐个应用成功生成的代码
                for (const item of result.results) {
                    if (item.success && item.historyId) {
                        try {
                            const applyResult = await api.ai.apply(item.historyId, null, false);
                            if (applyResult.success) {
                                appliedCount++;
                            } else {
                                failedCount++;
                            }
                        } catch (e) {
                            failedCount++;
                        }
                    }
                }
                
                // 应用完成后统一重载
                if (appliedCount > 0) {
                    try {
                        await api.sandbox.reloadAI();
                        showToast(`批量应用完成: ${appliedCount} 成功, ${failedCount} 失败 (已重载)`, 'success');
                    } catch (e) {
                        showToast(`批量应用完成: ${appliedCount} 成功, ${failedCount} 失败 (重载失败)`, 'warning');
                    }
                } else {
                    showToast(`批量应用失败`, 'error');
                }
            }
            
            refreshUndefinedList();
            loadAIHistory();
        } else {
            showToast(`批量补充失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`批量补充失败: ${error.message}`, 'error');
    }
}

// ========== AI补环境 ==========
async function loadAIConfig() {
    try {
        const result = await api.ai.getConfig();
        if (result.success) {
            document.getElementById('ai-platform').value = result.data.platform || 'openai';
            if (result.data.hasApiKey) {
                document.getElementById('ai-api-key').placeholder = '已配置 (输入新值覆盖)';
            }
        }
    } catch (error) {
        console.error('加载AI配置失败:', error);
    }
}

async function saveAIConfig() {
    const platform = document.getElementById('ai-platform').value;
    const apiKey = document.getElementById('ai-api-key').value;
    const baseUrl = document.getElementById('ai-base-url').value;
    
    try {
        const config = { platform };
        if (apiKey) config.apiKey = apiKey;
        if (baseUrl) config.baseUrl = baseUrl;
        
        const result = await api.ai.setConfig(config);
        if (result.success) {
            showToast('AI配置已保存', 'success');
            document.getElementById('ai-api-key').value = '';
            document.getElementById('ai-api-key').placeholder = '已配置 (输入新值覆盖)';
        }
    } catch (error) {
        showToast(`保存配置失败: ${error.message}`, 'error');
    }
}

async function generateEnvCode() {
    const property = document.getElementById('ai-property').value;
    const object = document.getElementById('ai-object').value || 'window';
    const context = document.getElementById('ai-context').value;
    
    if (!property) {
        showToast('请输入属性/方法名', 'warning');
        return;
    }
    
    showToast('正在生成代码...', 'info');
    
    try {
        const result = await api.ai.complete(property, object, context);
        
        if (result.success) {
            currentAIResult = result;
            document.getElementById('ai-result-code').value = result.code;
            document.getElementById('ai-result-info').textContent = `平台: ${result.platform} | 模型: ${result.model}`;
            document.getElementById('copy-ai-btn').disabled = false;
            document.getElementById('apply-ai-btn').disabled = false;
            
            showToast('代码生成成功', 'success');
            loadAIHistory();
        } else {
            document.getElementById('ai-result-code').value = `生成失败: ${result.error}`;
            document.getElementById('copy-ai-btn').disabled = true;
            document.getElementById('apply-ai-btn').disabled = true;
            
            showToast(`生成失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`生成失败: ${error.message}`, 'error');
    }
}

function copyGeneratedCode() {
    const code = document.getElementById('ai-result-code').value;
    navigator.clipboard.writeText(code);
    showToast('代码已复制', 'success');
}

async function applyGeneratedCode() {
    if (!currentAIResult || !currentAIResult.historyId) {
        showToast('没有可应用的代码', 'warning');
        return;
    }
    
    try {
        showToast('正在应用 AI 代码...', 'info');
        
        const result = await api.ai.apply(currentAIResult.historyId, null, true);
        
        if (result.success) {
            // 显示应用成功消息
            let message = `代码已应用: ${result.filename}`;
            
            // 如果自动重载成功，显示重载信息
            if (result.reloaded && result.reloadResult) {
                if (result.reloadResult.success) {
                    message += ` (已自动重载)`;
                } else {
                    message += ` (重载失败: ${result.reloadResult.error})`;
                }
            }
            
            showToast(message, 'success');
            
            // 刷新相关界面
            loadAIHistory();
            refreshEnvTree();
            refreshUndefinedList();
            
            // 清空当前结果
            document.getElementById('ai-result-code').value = '';
            document.getElementById('ai-result-info').textContent = '';
            currentAIResult = null;
            document.getElementById('apply-ai-btn').disabled = true;
            document.getElementById('copy-ai-btn').disabled = true;
        } else {
            showToast(`应用失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`应用失败: ${error.message}`, 'error');
    }
}

async function loadAIHistory() {
    try {
        const result = await api.ai.getHistory({ limit: 20 });
        const list = document.getElementById('ai-history-list');
        
        if (result.success && result.data.length > 0) {
            list.innerHTML = result.data.reverse().map(item => `
                <div class="history-item">
                    <span class="property">${item.property}</span>
                    <span class="platform">${item.platform}</span>
                    <span class="status status-badge ${item.status === 'applied' ? 'fixed' : 'unfixed'}">
                        ${item.status === 'applied' ? '已应用' : item.status === 'generated' ? '已生成' : '失败'}
                    </span>
                    <button class="btn btn-sm" onclick="viewHistory('${item.id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            `).join('');
        } else {
            list.innerHTML = '<div class="empty-state"><p>暂无历史记录</p></div>';
        }
    } catch (error) {
        console.error('加载AI历史失败:', error);
    }
}

async function viewHistory(id) {
    try {
        const result = await api.ai.getHistoryById(id);
        if (result.success) {
            openModal(
                `AI生成记录: ${result.data.property}`,
                `<pre style="background: var(--bg-color); padding: 16px; border-radius: 8px; overflow: auto; max-height: 400px;">${result.data.code || result.data.error}</pre>
                <div style="margin-top: 16px; color: var(--text-secondary);">
                    <p>平台: ${result.data.platform}</p>
                    <p>时间: ${result.data.timestamp}</p>
                    <p>状态: ${result.data.status}</p>
                </div>`,
                result.data.status === 'generated' ? 
                    `<button class="btn btn-primary" onclick="applyFromHistory('${id}')"><i class="fas fa-check"></i> 应用</button>` : ''
            );
        }
    } catch (error) {
        showToast(`加载失败: ${error.message}`, 'error');
    }
}

async function applyFromHistory(id) {
    try {
        showToast('正在应用 AI 代码...', 'info');
        
        const result = await api.ai.apply(id, null, true);
        
        if (result.success) {
            // 显示应用成功消息
            let message = `代码已应用: ${result.filename}`;
            
            // 如果自动重载成功，显示重载信息
            if (result.reloaded && result.reloadResult) {
                if (result.reloadResult.success) {
                    message += ` (已自动重载)`;
                } else {
                    message += ` (重载失败: ${result.reloadResult.error})`;
                }
            }
            
            showToast(message, 'success');
            closeModal();
            loadAIHistory();
            refreshEnvTree();
            refreshUndefinedList();
        } else {
            showToast(`应用失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`应用失败: ${error.message}`, 'error');
    }
}

// ========== 快照管理 ==========
async function loadSnapshots() {
    try {
        const result = await api.snapshot.list();
        const list = document.getElementById('snapshot-list');
        const emptyState = document.getElementById('no-snapshots');
        
        if (result.success && result.data.length > 0) {
            list.innerHTML = result.data.map(snap => `
                <div class="snapshot-card">
                    <h4><i class="fas fa-camera"></i> ${snap.name}</h4>
                    <div class="meta">
                        <p>创建时间: ${new Date(snap.createdAt).toLocaleString()}</p>
                        <p>环境文件: ${snap.envFilesCount} 个</p>
                    </div>
                    <div class="actions">
                        <button class="btn btn-sm btn-primary" onclick="loadSnapshot('${snap.name}')">
                            <i class="fas fa-upload"></i> 加载
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteSnapshot('${snap.name}')">
                            <i class="fas fa-trash"></i> 删除
                        </button>
                    </div>
                </div>
            `).join('');
            emptyState.style.display = 'none';
        } else {
            list.innerHTML = '';
            emptyState.style.display = 'block';
        }
    } catch (error) {
        showToast(`加载快照列表失败: ${error.message}`, 'error');
    }
}

async function createSnapshot() {
    const name = document.getElementById('snapshot-name').value.trim();
    if (!name) {
        showToast('请输入快照名称', 'warning');
        return;
    }
    
    try {
        const result = await api.snapshot.save(name);
        if (result.success) {
            showToast('快照已保存', 'success');
            document.getElementById('snapshot-name').value = '';
            loadSnapshots();
        } else {
            showToast(`保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`保存失败: ${error.message}`, 'error');
    }
}

async function loadSnapshot(name) {
    try {
        const result = await api.snapshot.load(name);
        if (result.success) {
            showToast(`快照 "${name}" 已加载`, 'success');
            loadSandboxStatus();
        } else {
            showToast(`加载失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`加载失败: ${error.message}`, 'error');
    }
}

async function deleteSnapshot(name) {
    if (!confirm(`确定要删除快照 "${name}" 吗?`)) return;
    
    try {
        const result = await api.snapshot.delete(name);
        if (result.success) {
            showToast('快照已删除', 'success');
            loadSnapshots();
        } else {
            showToast(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`删除失败: ${error.message}`, 'error');
    }
}

// ========== 日志查看 ==========
async function loadLogs() {
    try {
        // 访问日志
        const accessResult = await api.sandbox.getLogs('access', 50);
        const accessList = document.getElementById('access-log-list');
        if (accessResult.success && accessResult.data.access) {
            accessList.innerHTML = accessResult.data.access.map(log => `
                <div class="log-entry">
                    <span class="timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span class="type">[${log.type}]</span>
                    <span class="path">${log.path}</span>
                    <span class="value">${log.value}</span>
                </div>
            `).join('') || '<div class="empty-state"><p>暂无访问日志</p></div>';
        }
        
        // Undefined日志
        const undefinedResult = await api.log.getUndefined();
        const undefinedList = document.getElementById('undefined-log-list');
        if (undefinedResult.success) {
            undefinedList.innerHTML = undefinedResult.data.map(log => `
                <div class="log-entry">
                    <span class="timestamp">${log.timestamp || '-'}</span>
                    <span class="path">${log.path}</span>
                    <span class="status">${log.status}</span>
                </div>
            `).join('') || '<div class="empty-state"><p>暂无undefined日志</p></div>';
        }
        
        // AI历史
        const aiResult = await api.log.getAIHistory();
        const aiList = document.getElementById('ai-log-list');
        if (aiResult.success) {
            aiList.innerHTML = aiResult.data.map(log => `
                <div class="log-entry ${log.status === 'failed' ? 'error' : ''}">
                    <span class="timestamp">${new Date(log.timestamp).toLocaleString()}</span>
                    <span class="path">${log.property}</span>
                    <span class="status">${log.status}</span>
                    <span class="platform">${log.platform}</span>
                </div>
            `).join('') || '<div class="empty-state"><p>暂无AI历史</p></div>';
        }
    } catch (error) {
        showToast(`加载日志失败: ${error.message}`, 'error');
    }
}

async function exportLogs() {
    try {
        const result = await api.log.export();
        if (result.success) {
            const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `logs_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('日志已导出', 'success');
        }
    } catch (error) {
        showToast(`导出失败: ${error.message}`, 'error');
    }
}

async function clearLogs() {
    if (!confirm('确定要清空所有日志吗?')) return;
    
    try {
        await api.log.clear('all');
        await api.sandbox.clearLogs();
        showToast('日志已清空', 'success');
        loadLogs();
    } catch (error) {
        showToast(`清空失败: ${error.message}`, 'error');
    }
}

// ========== Mock配置 ==========
let mockList = [];

async function refreshMockList() {
    try {
        const result = await api.sandbox.status();
        if (result.success && result.stats) {
            const tbody = document.getElementById('mock-table-body');
            const emptyState = document.getElementById('no-mocks');
            
            // 模拟获取mock列表（实际需要后端支持）
            // 目前从本地状态获取
            if (mockList.length > 0) {
                tbody.innerHTML = mockList.map(mock => `
                    <tr>
                        <td><code>${mock.path}</code></td>
                        <td>${mock.returnType || 'any'}</td>
                        <td><span class="value-preview">${mock.preview || '-'}</span></td>
                        <td>${mock.callCount || 0}</td>
                        <td>
                            <span class="status-badge ${mock.enabled ? 'fixed' : 'unfixed'}">
                                ${mock.enabled ? '启用' : '禁用'}
                            </span>
                        </td>
                        <td>
                            <button class="btn btn-sm" onclick="editMock('${mock.path}')">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="deleteMock('${mock.path}')">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
                emptyState.style.display = 'none';
            } else {
                tbody.innerHTML = '';
                emptyState.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('刷新Mock列表失败:', error);
    }
}

function showAddMockModal() {
    openModal(
        '添加Mock配置',
        `
        <div class="form-group">
            <label>方法/属性路径</label>
            <input type="text" id="mock-path" placeholder="如: document.getElementById, canvas.getContext">
        </div>
        <div class="form-group">
            <label>返回类型</label>
            <select id="mock-return-type">
                <option value="null">null</option>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="object">object</option>
                <option value="function">function</option>
                <option value="custom">自定义代码</option>
            </select>
        </div>
        <div class="form-group">
            <label>返回值 / 处理代码</label>
            <textarea id="mock-return-value" rows="5" placeholder="输入返回值或处理函数代码..."></textarea>
        </div>
        <div class="form-group">
            <label class="checkbox-label">
                <input type="checkbox" id="mock-enabled" checked>
                启用此Mock
            </label>
        </div>
        `,
        `<button class="btn btn-primary" onclick="saveMock()"><i class="fas fa-save"></i> 保存</button>`
    );
}

async function saveMock() {
    const path = document.getElementById('mock-path').value.trim();
    const returnType = document.getElementById('mock-return-type').value;
    const returnValue = document.getElementById('mock-return-value').value;
    const enabled = document.getElementById('mock-enabled').checked;
    
    if (!path) {
        showToast('请输入方法/属性路径', 'warning');
        return;
    }
    
    // 构建mock配置
    const mockConfig = {
        path: path,
        returnType: returnType,
        returnValue: returnValue,
        enabled: enabled,
        preview: returnValue.substring(0, 30) + (returnValue.length > 30 ? '...' : ''),
        callCount: 0
    };
    
    // 生成注入代码
    let injectCode;
    switch (returnType) {
        case 'null':
            injectCode = `__EnvMonitor__.setMock('${path}', { returnValue: null, enabled: ${enabled} });`;
            break;
        case 'string':
            injectCode = `__EnvMonitor__.setMock('${path}', { returnValue: ${JSON.stringify(returnValue)}, enabled: ${enabled} });`;
            break;
        case 'number':
            injectCode = `__EnvMonitor__.setMock('${path}', { returnValue: ${parseFloat(returnValue) || 0}, enabled: ${enabled} });`;
            break;
        case 'boolean':
            injectCode = `__EnvMonitor__.setMock('${path}', { returnValue: ${returnValue === 'true'}, enabled: ${enabled} });`;
            break;
        case 'object':
            injectCode = `__EnvMonitor__.setMock('${path}', { returnValue: ${returnValue || '{}'}, enabled: ${enabled} });`;
            break;
        case 'function':
        case 'custom':
            injectCode = `__EnvMonitor__.setMock('${path}', { handler: function(...args) { ${returnValue} }, enabled: ${enabled} });`;
            break;
    }
    
    try {
        const result = await api.sandbox.inject(injectCode);
        if (result.success) {
            // 更新本地列表
            const existing = mockList.findIndex(m => m.path === path);
            if (existing >= 0) {
                mockList[existing] = mockConfig;
            } else {
                mockList.push(mockConfig);
            }
            
            showToast('Mock配置已保存', 'success');
            closeModal();
            refreshMockList();
        } else {
            showToast(`保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`保存失败: ${error.message}`, 'error');
    }
}

function editMock(path) {
    const mock = mockList.find(m => m.path === path);
    if (!mock) return;
    
    showAddMockModal();
    setTimeout(() => {
        document.getElementById('mock-path').value = mock.path;
        document.getElementById('mock-return-type').value = mock.returnType;
        document.getElementById('mock-return-value').value = mock.returnValue;
        document.getElementById('mock-enabled').checked = mock.enabled;
    }, 100);
}

async function deleteMock(path) {
    if (!confirm(`确定要删除 ${path} 的Mock配置吗?`)) return;
    
    try {
        const injectCode = `__EnvMonitor__.removeMock('${path}');`;
        const result = await api.sandbox.inject(injectCode);
        
        if (result.success) {
            mockList = mockList.filter(m => m.path !== path);
            showToast('Mock已删除', 'success');
            refreshMockList();
        }
    } catch (error) {
        showToast(`删除失败: ${error.message}`, 'error');
    }
}

// 预设Mock模板
const mockPresets = {
    'anti-detect': [
        { path: 'navigator.webdriver', returnType: 'boolean', returnValue: 'false', enabled: true },
        { path: 'navigator.plugins', returnType: 'object', returnValue: '[{name:"Chrome PDF Plugin"},{name:"Chrome PDF Viewer"}]', enabled: true },
        { path: 'navigator.languages', returnType: 'object', returnValue: '["zh-CN", "zh", "en"]', enabled: true }
    ],
    'canvas-fp': [
        { path: 'canvas.toDataURL', returnType: 'string', returnValue: '"data:image/png;base64,iVBORw0KGgo..."', enabled: true },
        { path: 'canvas2d.getImageData', returnType: 'custom', returnValue: 'const data = new Uint8ClampedArray(args[2] * args[3] * 4).fill(128); return { width: args[2], height: args[3], data: data };', enabled: true }
    ],
    'webgl-fp': [
        { path: 'webgl.getParameter', returnType: 'custom', returnValue: 'const params = { 7936: "NVIDIA Corporation", 7937: "NVIDIA GeForce RTX 3080" }; return params[args[0]] || null;', enabled: true },
        { path: 'webgl.getSupportedExtensions', returnType: 'object', returnValue: '["WEBGL_debug_renderer_info"]', enabled: true }
    ],
    'audio-fp': [
        { path: 'AudioContext', returnType: 'custom', returnValue: 'return { sampleRate: 44100, state: "running", createAnalyser: () => ({}) };', enabled: true }
    ]
};

async function applyPresetMock(presetName) {
    const preset = mockPresets[presetName];
    if (!preset) return;
    
    showToast(`正在应用预设: ${presetName}...`, 'info');
    
    for (const mock of preset) {
        const injectCode = mock.returnType === 'custom' || mock.returnType === 'function'
            ? `__EnvMonitor__.setMock('${mock.path}', { handler: function(...args) { ${mock.returnValue} }, enabled: ${mock.enabled} });`
            : `__EnvMonitor__.setMock('${mock.path}', { returnValue: ${mock.returnValue}, enabled: ${mock.enabled} });`;
        
        try {
            await api.sandbox.inject(injectCode);
            
            const existing = mockList.findIndex(m => m.path === mock.path);
            if (existing >= 0) {
                mockList[existing] = { ...mock, preview: String(mock.returnValue).substring(0, 30) };
            } else {
                mockList.push({ ...mock, preview: String(mock.returnValue).substring(0, 30), callCount: 0 });
            }
        } catch (e) {
            console.error(`应用Mock失败: ${mock.path}`, e);
        }
    }
    
    showToast('预设已应用', 'success');
    refreshMockList();
}

// ========== 监控面板 ==========
let monitorInterval = null;

async function refreshMonitorStats() {
    try {
        const result = await api.sandbox.status();
        
        if (result.success && result.stats) {
            const stats = result.stats.loggerStats || {};
            
            document.getElementById('stat-access').textContent = stats.totalAccess || 0;
            document.getElementById('stat-calls').textContent = stats.totalCalls || 0;
            document.getElementById('stat-create').textContent = 0; // 需要后端支持
            document.getElementById('stat-undefined').textContent = stats.totalUndefined || 0;
            document.getElementById('stat-fixed').textContent = (stats.totalUndefined - stats.unfixedUndefined) || 0;
            document.getElementById('stat-mocks').textContent = mockList.filter(m => m.enabled).length;
        }
        
        // 加载热点方法
        await loadHotMethods();
        
        // 加载元素类型统计
        await loadElementTypes();
        
        // 加载调用链
        await loadCallChains();
        
    } catch (error) {
        console.error('刷新监控数据失败:', error);
    }
}

async function loadHotMethods() {
    try {
        const result = await api.sandbox.getLogs('calls', 100);
        const list = document.getElementById('hot-methods-list');
        
        if (result.success && result.data.calls) {
            // 统计方法调用频率
            const methodCount = {};
            result.data.calls.forEach(log => {
                const method = log.path || 'unknown';
                methodCount[method] = (methodCount[method] || 0) + 1;
            });
            
            // 排序并取前10
            const sorted = Object.entries(methodCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            if (sorted.length > 0) {
                const maxCount = sorted[0][1];
                list.innerHTML = sorted.map(([method, count]) => `
                    <div class="hot-item">
                        <span class="method">${method}</span>
                        <div class="bar-container">
                            <div class="bar" style="width: ${(count / maxCount * 100)}%"></div>
                        </div>
                        <span class="count">${count}</span>
                    </div>
                `).join('');
            } else {
                list.innerHTML = '<div class="empty-state"><p>暂无调用数据</p></div>';
            }
        }
    } catch (error) {
        console.error('加载热点方法失败:', error);
    }
}

async function loadElementTypes() {
    try {
        const result = await api.sandbox.getLogs('access', 200);
        const list = document.getElementById('element-types-list');
        
        if (result.success && result.data.access) {
            // 提取 createElement 调用
            const createLogs = result.data.access.filter(log => 
                log.path && log.path.includes('createElement')
            );
            
            // 统计元素类型
            const typeCount = {};
            createLogs.forEach(log => {
                // 解析元素类型
                const match = log.value?.match(/tagName[:\s]*['"]?(\w+)/i);
                if (match) {
                    const type = match[1].toUpperCase();
                    typeCount[type] = (typeCount[type] || 0) + 1;
                }
            });
            
            const types = Object.entries(typeCount);
            
            if (types.length > 0) {
                list.innerHTML = types.map(([type, count]) => `
                    <div class="element-type-item">
                        <span class="tag">&lt;${type.toLowerCase()}&gt;</span>
                        <span class="count">${count}</span>
                    </div>
                `).join('');
            } else {
                list.innerHTML = '<div class="empty-state"><p>暂无创建元素</p></div>';
            }
        }
    } catch (error) {
        console.error('加载元素类型失败:', error);
    }
}

async function loadCallChains() {
    try {
        const result = await api.sandbox.getLogs('calls', 20);
        const list = document.getElementById('call-chain-list');
        
        if (result.success && result.data.calls) {
            const chains = result.data.calls.slice(-10).reverse();
            
            if (chains.length > 0) {
                list.innerHTML = chains.map(log => `
                    <div class="chain-item">
                        <span class="time">${new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span class="chain">${log.path}</span>
                        <span class="args">(${Array.isArray(log.args) ? log.args.join(', ') : ''})</span>
                        <span class="result">→ ${log.result || 'void'}</span>
                    </div>
                `).join('');
            } else {
                list.innerHTML = '<div class="empty-state"><p>暂无调用链数据</p></div>';
            }
        }
    } catch (error) {
        console.error('加载调用链失败:', error);
    }
}

// 自动刷新监控
document.addEventListener('DOMContentLoaded', () => {
    const autoRefreshCheckbox = document.getElementById('auto-refresh-monitor');
    if (autoRefreshCheckbox) {
        autoRefreshCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                startMonitorRefresh();
            } else {
                stopMonitorRefresh();
            }
        });
    }
});

function startMonitorRefresh() {
    if (monitorInterval) return;
    monitorInterval = setInterval(refreshMonitorStats, 3000);
}

function stopMonitorRefresh() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
}

// 页面切换时的处理
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const page = item.dataset.page;
        
        if (page === 'monitor') {
            refreshMonitorStats();
            if (document.getElementById('auto-refresh-monitor')?.checked) {
                startMonitorRefresh();
            }
        } else {
            stopMonitorRefresh();
        }
        
        if (page === 'mock') {
            refreshMockList();
        }
    });
});
