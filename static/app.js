// 全局状态
let currentPage = 1;
let pageSize = 50;
let currentSearch = '';
let totalPages = 1;
let currentDeleteHash = null;
let bucketData = null;  // 分桶数据缓存
let bucketPathFilters = {};  // {rootFolderName: [path_prefixes]}
let bucketRoots = new Set();  // 桶根文件夹集合

// API 基础路径
const API_BASE = '/api';

// 获取 Basic Auth 头
function getAuthHeader() {
    // 使用 cookie 或提示用户输入
    // 由于页面本身通过 Basic Auth 保护，fetch 请求会自动携带凭据
    return {};
}

// 通用请求函数
async function fetchAPI(url, options = {}) {
    const defaultOptions = {
        credentials: 'same-origin',  // 携带 cookie
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
            ...options.headers,
        },
    };
    
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (response.status === 401) {
        // 认证失败，刷新页面会触发浏览器登录框
        window.location.reload();
        return null;
    }
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: '请求失败' }));
        throw new Error(error.detail || '请求失败');
    }
    
    return response.json();
}

// 加载统计信息
async function loadStats() {
    try {
        const stats = await fetchAPI(`${API_BASE}/stats`);
        if (stats) {
            document.getElementById('stat-total').textContent = (stats.total ?? 0).toLocaleString();
            document.getElementById('stat-public').textContent = (stats.public ?? 0).toLocaleString();
            document.getElementById('stat-private').textContent = (stats.private ?? 0).toLocaleString();
        }
    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

// 加载资源列表
async function loadResources() {
    const loading = document.getElementById('loading');
    const tbody = document.getElementById('resourceBody');
    
    loading.style.display = 'flex';
    tbody.innerHTML = '';
    
    try {
        const params = new URLSearchParams({
            page: currentPage,
            page_size: pageSize,
            search: currentSearch,
        });
        
        const data = await fetchAPI(`${API_BASE}/resources?${params}`);
        
        if (data) {
            totalPages = data.total_pages;
            renderTable(data.items);
            updatePagination(data);
        }
    } catch (error) {
        console.error('加载资源失败:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--accent-red); padding: 40px;">
                    加载失败: ${error.message}
                </td>
            </tr>
        `;
    } finally {
        loading.style.display = 'none';
    }
}

// 渲染表格
function renderTable(items) {
    const tbody = document.getElementById('resourceBody');
    
    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 40px;">
                    暂无数据
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = items.map(item => `
        <tr>
            <td class="col-name">
                <span class="resource-name" title="${escapeHtml(item.rootFolderName)}">
                    📁 ${escapeHtml(item.rootFolderName)}
                </span>
            </td>
            <td class="col-hash">
                <code class="hash-text">${item.codeHash.substring(0, 12)}...</code>
            </td>
            <td class="col-status">
                ${getStatusBadge(item.visibleFlag)}
            </td>
            <td class="col-time">
                ${formatTime(item.timeStamp)}
            </td>
            <td class="col-actions">
                <button class="action-btn action-btn-view" onclick="viewResource('${item.codeHash}')">
                    查看
                </button>
                <button class="action-btn action-btn-delete" onclick="confirmDelete('${item.codeHash}', '${escapeHtml(item.rootFolderName)}')">
                    删除
                </button>
            </td>
        </tr>
    `).join('');
}

// 获取状态徽章
function getStatusBadge(visibleFlag) {
    if (visibleFlag === true) {
        return '<span class="badge badge-public">公开</span>';
    } else if (visibleFlag === false) {
        return '<span class="badge badge-private">私有</span>';
    } else {
        return '<span class="badge badge-pending">待审核</span>';
    }
}

// 格式化时间
function formatTime(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 更新分页
function updatePagination(data) {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const pageInfo = document.getElementById('pageInfo');
    
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    pageInfo.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页 (共 ${data.total} 条)`;
}

// 查看资源详情
async function viewResource(hash) {
    try {
        const resource = await fetchAPI(`${API_BASE}/resources/${hash}`);
        if (resource) {
            showDetailModal(resource);
        }
    } catch (error) {
        alert('获取详情失败: ' + error.message);
    }
}

// 显示详情弹窗
function showDetailModal(resource) {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    
    content.innerHTML = `
        <div class="detail-grid">
            <span class="detail-label">资源名称:</span>
            <span class="detail-value">${escapeHtml(resource.rootFolderName)}</span>
            
            <span class="detail-label">Hash:</span>
            <span class="detail-value code">${resource.codeHash}</span>
            
            <span class="detail-label">状态:</span>
            <span class="detail-value">${getStatusBadge(resource.visibleFlag)}</span>
            
            <span class="detail-label">创建时间:</span>
            <span class="detail-value">${formatTime(resource.timeStamp)}</span>
            
            <span class="detail-label">分享码:</span>
            <span class="detail-value code" style="font-size: 12px; max-height: 100px; overflow: auto;">
                ${resource.shareCode}
            </span>
        </div>
    `;
    
    // 设置复制按钮事件
    document.getElementById('copyShareCode').onclick = () => {
        navigator.clipboard.writeText(resource.shareCode).then(() => {
            alert('已复制到剪贴板');
        }).catch(() => {
            // 降级方案
            const textarea = document.createElement('textarea');
            textarea.value = resource.shareCode;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('已复制到剪贴板');
        });
    };
    
    modal.style.display = 'flex';
}

// 确认删除
function confirmDelete(hash, name) {
    currentDeleteHash = hash;
    document.getElementById('deleteTarget').textContent = name;
    document.getElementById('deleteModal').style.display = 'flex';
}

// 执行删除
async function executeDelete() {
    if (!currentDeleteHash) return;
    
    try {
        await fetchAPI(`${API_BASE}/resources/${currentDeleteHash}`, {
            method: 'DELETE',
        });
        
        document.getElementById('deleteModal').style.display = 'none';
        currentDeleteHash = null;
        
        // 刷新列表
        loadResources();
        loadStats();
    } catch (error) {
        alert('删除失败: ' + error.message);
    }
}

// 导入相关
let importData = null;

function initImport() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const importBtn = document.getElementById('importBtn');
    const closeImportModal = document.getElementById('closeImportModal');
    const cancelImport = document.getElementById('cancelImport');
    const confirmImport = document.getElementById('confirmImport');
    
    // 打开导入弹窗
    importBtn.addEventListener('click', () => {
        importData = null;
        document.getElementById('importPreview').style.display = 'none';
        document.getElementById('importResult').style.display = 'none';
        document.getElementById('confirmImport').disabled = true;
        document.getElementById('importModal').style.display = 'flex';
    });
    
    // 关闭弹窗
    closeImportModal.addEventListener('click', () => {
        document.getElementById('importModal').style.display = 'none';
    });
    
    cancelImport.addEventListener('click', () => {
        document.getElementById('importModal').style.display = 'none';
    });
    
    // 拖拽事件
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    // 点击选择文件
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
    
    // 确认导入
    confirmImport.addEventListener('click', executeImport);
}

// 处理文件
function handleFile(file) {
    if (!file.name.endsWith('.json') && !file.name.endsWith('.txt') && !file.name.endsWith('.123share')) {
        alert('请选择 JSON、TXT 或 123share 文件');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        
        // 尝试解析为 JSON
        try {
            importData = JSON.parse(content);
            showImportPreview(importData);
            return;
        } catch (e) {
            // 不是 JSON 格式
        }
        
        // 尝试解析为 123FastLink 文本格式
        if (content.includes('123FLCP') || content.includes('#')) {
            importData = content;
            showImportPreview({type: 'text', content: content});
            return;
        }
        
        alert('无法识别文件格式');
    };
    reader.readAsText(file);
}

// 显示导入预览
function showImportPreview(data) {
    const preview = document.getElementById('importPreview');
    const content = document.getElementById('previewContent');
    
    // 判断是否为文本格式
    if (data.type === 'text') {
        const lines = data.content.split('\n').filter(l => l.trim());
        const sampleLines = lines.slice(0, 3);
        
        content.innerHTML = `
            <div class="preview-item">
                <span>格式</span>
                <span>123FastLink 文本格式</span>
            </div>
            <div class="preview-item">
                <span>行数</span>
                <span>${lines.length.toLocaleString()} 条</span>
            </div>
            <div class="preview-item">
                <span>示例</span>
                <span style="font-size: 12px; word-break: break-all;">${sampleLines.join('<br>')}</span>
            </div>
        `;
    } else {
        const filesCount = data.files ? data.files.length : 0;
        const totalSize = data.totalSize || 0;
        
        content.innerHTML = `
            <div class="preview-item">
                <span>格式</span>
                <span>123FastLink JSON 格式</span>
            </div>
            <div class="preview-item">
                <span>脚本版本</span>
                <span>${data.scriptVersion || '-'}</span>
            </div>
            <div class="preview-item">
                <span>导出版本</span>
                <span>${data.exportVersion || '-'}</span>
            </div>
            <div class="preview-item">
                <span>公共路径</span>
                <span>${data.commonPath || '-'}</span>
            </div>
            <div class="preview-item">
                <span>文件数量</span>
                <span>${filesCount.toLocaleString()} 个</span>
            </div>
            <div class="preview-item">
                <span>总大小</span>
                <span>${formatSize(totalSize)}</span>
            </div>
        `;
    }
    
    preview.style.display = 'block';
    document.getElementById('confirmImport').disabled = false;
}

// 格式化文件大小
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 执行导入
async function executeImport() {
    if (!importData) return;
    
    const confirmBtn = document.getElementById('confirmImport');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '导入中...';
    
    try {
        let body, contentType;
        
        if (typeof importData === 'string') {
            // 文本格式
            body = importData;
            contentType = 'text/plain';
        } else {
            // JSON 格式
            body = JSON.stringify(importData);
            contentType = 'application/json';
        }
        
        const result = await fetchAPI(`${API_BASE}/resources/import`, {
            method: 'POST',
            body: body,
            headers: {
                'Content-Type': contentType
            }
        });
        
        if (result) {
            const resultDiv = document.getElementById('importResult');
            const resultContent = document.getElementById('resultContent');
            
            let html = `
                <div class="result-success">
                    ✅ 成功导入: ${result.imported} 条
                </div>
            `;
            
            if (result.skipped > 0) {
                html += `<div style="color: var(--accent-yellow);">⏭️ 跳过重复: ${result.skipped} 条</div>`;
            }
            
            if (result.errors && result.errors.length > 0) {
                html += `
                    <div class="result-error">
                        ❌ 错误: ${result.errors.join('<br>')}
                    </div>
                `;
            }
            
            resultContent.innerHTML = html;
            resultDiv.style.display = 'block';
            
            // 刷新缓存和列表
            await fetchAPI(`${API_BASE}/refresh`, { method: 'POST' });
            await loadResources();
            await loadStats();
        }
    } catch (error) {
        alert('导入失败: ' + error.message);
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认导入';
    }
}

// 事件绑定
function initEventListeners() {
    // 搜索
    document.getElementById('searchBtn').addEventListener('click', () => {
        currentSearch = document.getElementById('searchInput').value.trim();
        currentPage = 1;
        loadResources();
    });
    
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            currentSearch = e.target.value.trim();
            currentPage = 1;
            loadResources();
        }
    });
    
    // 清除搜索
    document.getElementById('clearBtn').addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        currentSearch = '';
        currentPage = 1;
        loadResources();
    });
    
    // 刷新
    document.getElementById('refreshBtn').addEventListener('click', async () => {
        const btn = document.getElementById('refreshBtn');
        btn.disabled = true;
        btn.textContent = '刷新中...';
        
        try {
            // 先刷新缓存
            await fetchAPI(`${API_BASE}/refresh`, { method: 'POST' });
            // 再加载数据
            await loadResources();
            await loadStats();
        } finally {
            btn.disabled = false;
            btn.textContent = '🔄 刷新';
        }
    });
    
    // 分页
    document.getElementById('prevBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadResources();
        }
    });
    
    document.getElementById('nextBtn').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            loadResources();
        }
    });
    
    // 每页条数
    document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
        pageSize = parseInt(e.target.value);
        currentPage = 1;
        loadResources();
    });
    
    // 关闭弹窗
    document.getElementById('closeDetailModal').addEventListener('click', () => {
        document.getElementById('detailModal').style.display = 'none';
    });
    
    document.getElementById('closeDetail').addEventListener('click', () => {
        document.getElementById('detailModal').style.display = 'none';
    });
    
    // 删除
    document.getElementById('closeDeleteModal').addEventListener('click', () => {
        document.getElementById('deleteModal').style.display = 'none';
    });
    
    document.getElementById('cancelDelete').addEventListener('click', () => {
        document.getElementById('deleteModal').style.display = 'none';
    });
    
    document.getElementById('confirmDelete').addEventListener('click', executeDelete);
    
    // 点击弹窗外部关闭
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    initImport();
    initBucketListeners();
    loadStats();
    loadResources();
});

// ==================== 分桶管理 ====================

// 缓存: 展开的根文件夹的内部结构
let folderStructureCache = {};

function initBucketListeners() {
    document.getElementById('bucketBtn').addEventListener('click', openBucketModal);
    document.getElementById('closeBucketModal').addEventListener('click', () => {
        document.getElementById('bucketModal').style.display = 'none';
    });
    document.getElementById('cancelBuckets').addEventListener('click', () => {
        document.getElementById('bucketModal').style.display = 'none';
    });
    document.getElementById('applyBuckets').addEventListener('click', applyBuckets);
    document.getElementById('bucketSelectAll').addEventListener('click', () => setAllBuckets(true));
    document.getElementById('bucketDeselectAll').addEventListener('click', () => setAllBuckets(false));
    document.getElementById('bucketInvert').addEventListener('click', invertBuckets);
}

// 按十年分组文件夹
function groupFoldersByDecade(folders) {
    const groups = {};
    const others = [];
    
    folders.forEach(folder => {
        const match = folder.name.match(/(\d{4})$/);
        if (match) {
            const year = parseInt(match[1]);
            const decade = Math.floor(year / 10) * 10;
            const groupKey = decade + 's';
            if (!groups[groupKey]) {
                groups[groupKey] = { decade: groupKey, minYear: decade, maxYear: decade + 9, folders: [] };
            }
            groups[groupKey].folders.push(folder);
        } else {
            others.push(folder);
        }
    });
    
    const sorted = Object.values(groups).sort((a, b) => b.decade - a.decade);
    sorted.forEach(g => g.folders.sort((a, b) => a.name.localeCompare(b.name)));
    sorted.forEach(g => {
        g.totalCount = g.folders.reduce((sum, f) => sum + f.count, 0);
    });
    
    return { groups: sorted, others };
}

async function openBucketModal() {
    const modal = document.getElementById('bucketModal');
    const list = document.getElementById('bucketList');
    list.innerHTML = '<div style="text-align:center;padding:20px;">加载中...</div>';
    modal.style.display = 'flex';
    folderStructureCache = {};  // 重置缓存
    
    try {
        const data = await fetchAPI(`${API_BASE}/buckets/folders`);
        if (!data) return;
        
        bucketData = data;
        // 还原 bucket_root 和 path_filters 状态
        bucketRoots = new Set(data.bucket_roots || []);
        const activeSet = new Set(data.active || []);
        const hasActiveFilter = activeSet.size > 0;
        bucketPathFilters = data.path_filters || {};
        
        if (hasActiveFilter) {
            const decadeNames = groupFoldersByDecade(
                data.active.map(n => ({ name: n, count: 0 }))
            ).groups.map(g => g.decade).join(', ');
            let status = '🔍 已过滤：<strong>' + decadeNames + '</strong>';
            if (Object.keys(bucketPathFilters).length > 0) {
                const pfSummary = Object.entries(bucketPathFilters)
                    .map(([k, v]) => k + ': ' + v.join(','))
                    .join('; ');
                status += ' | 路径筛选: ' + pfSummary;
            }
            document.getElementById('bucketStatus').innerHTML = status;
        } else {
            document.getElementById('bucketStatus').innerHTML = '📂 全部加载（未过滤）';
        }
        
        renderBucketTree(data.folders, activeSet);
        
        // 自动展开所有根文件夹的内部结构
        const names = data.folders.map(f => f.name);
        await expandAllFolders(names);
    } catch (error) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--accent-red);">加载失败: ${error.message}</div>`;
    }
}

function renderBucketTree(folders, activeSet) {
    const list = document.getElementById('bucketList');
    const hasActiveFilter = activeSet.size > 0;
    const { groups, others } = groupFoldersByDecade(folders);
    
    if (groups.length === 0 && others.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">暂无文件夹</div>';
        return;
    }
    
    let html = '';
    
    groups.forEach(group => {
        const allChecked = group.folders.every(f => hasActiveFilter ? activeSet.has(f.name) : true);
        const someChecked = group.folders.some(f => hasActiveFilter ? activeSet.has(f.name) : true);
        
        html += `
            <div class="bucket-group">
                <div class="bucket-group-header" onclick="toggleBucketGroup(this)" data-decade="${group.decade}">
                    <span class="bucket-group-arrow">▼</span>
                    <label class="bucket-group-label" onclick="event.stopPropagation()">
                        <input type="checkbox" class="bucket-group-checkbox" 
                            data-decade="${group.decade}" ${allChecked ? 'checked' : ''}
                            onchange="toggleGroupChildren(this)" />
                        <span class="bucket-group-name">📅 ${group.decade} (${group.minYear}-${group.maxYear})</span>
                    </label>
                    <span class="bucket-group-count">${(group.totalCount ?? 0).toLocaleString()} 条 | ${group.folders.length} 个文件夹</span>
                </div>
                <div class="bucket-group-children">
        `;
        
        group.folders.forEach(folder => {
            const isChecked = hasActiveFilter ? activeSet.has(folder.name) : true;
            const hasPathFilter = bucketPathFilters[folder.name] && bucketPathFilters[folder.name].length > 0;
            html += `
                <div class="bucket-item-row" data-folder="${escapeHtml(folder.name)}">
                    <label class="bucket-item">
                        <input type="checkbox" class="bucket-checkbox" data-name="${escapeHtml(folder.name)}" data-decade="${group.decade}" ${isChecked ? 'checked' : ''} />
                        <span class="bucket-name">${escapeHtml(folder.name)}</span>
                        <span class="bucket-count">${(folder.count ?? 0).toLocaleString()} 条</span>
                    </label>
                    <button class="bucket-expand-btn" onclick="toggleFoldersExpand('${escapeHtml(folder.name)}', this)" title="展开查看内部子文件夹">
                        ${hasPathFilter ? '📂' : '▶'}
                    </button>
                    <button class="bucket-root-btn ${bucketRoots.has(folder.name) ? 'active' : ''}" 
                        data-root="${escapeHtml(folder.name)}"
                        onclick="setBucketRoot('${escapeHtml(folder.name)}', this)" 
                        title="选为桶根：其子目录按名 hash 重新分配到 256 个桶（仅 SPLIT_FOLDER 模式生效）">
                        ${bucketRoots.has(folder.name) ? '🎯 当前桶根' : '🎯 设为桶根'}
                    </button>
                </div>
                <div class="bucket-subfolders" id="sub-${escapeHtml(folder.name).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}" style="display:none;"></div>
            `;
        });
        
        html += `</div></div>`;
    });
    
    if (others.length > 0) {
        html += `
            <div class="bucket-group">
                <div class="bucket-group-header" onclick="toggleBucketGroup(this)" data-decade="other">
                    <span class="bucket-group-arrow">▼</span>
                    <span class="bucket-group-name" style="margin-left:4px;">📁 其他</span>
                    <span class="bucket-group-count">${others.length} 个文件夹</span>
                </div>
                <div class="bucket-group-children">
        `;
        others.forEach(folder => {
            const hasPathFilter = bucketPathFilters[folder.name] && bucketPathFilters[folder.name].length > 0;
            html += `
                <div class="bucket-item-row" data-folder="${escapeHtml(folder.name)}">
                    <label class="bucket-item">
                        <input type="checkbox" class="bucket-checkbox" data-name="${escapeHtml(folder.name)}" data-decade="other" checked />
                        <span class="bucket-name">${escapeHtml(folder.name)}</span>
                        <span class="bucket-count">${(folder.count ?? 0).toLocaleString()} 条</span>
                    </label>
                    <button class="bucket-expand-btn" onclick="toggleFoldersExpand('${escapeHtml(folder.name)}', this)" title="展开查看内部子文件夹">
                        ${hasPathFilter ? '📂' : '▶'}
                    </button>
                    <button class="bucket-root-btn ${bucketRoots.has(folder.name) ? 'active' : ''}" 
                        data-root="${escapeHtml(folder.name)}"
                        onclick="setBucketRoot('${escapeHtml(folder.name)}', this)" 
                        title="选为桶根：其子目录按名 hash 重新分配到 256 个桶（仅 SPLIT_FOLDER 模式生效）">
                        ${bucketRoots.has(folder.name) ? '🎯 当前桶根' : '🎯 设为桶根'}
                    </button>
                </div>
                <div class="bucket-subfolders" id="sub-${escapeHtml(folder.name).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}" style="display:none;"></div>
            `;
        });
        html += `</div></div>`;
    }
    
    list.innerHTML = html;
    updateBucketSelectedCount();
    
    // 自动展开有 path_filter 的文件夹
    Object.keys(bucketPathFilters).forEach(folderName => {
        if (bucketPathFilters[folderName] && bucketPathFilters[folderName].length > 0) {
            const safeId = folderName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
            const subDiv = document.getElementById('sub-' + safeId);
            if (subDiv) {
                autoExpandFolder(folderName, subDiv);
            }
        }
    });
}

async function expandAllFolders(names) {
    for (const name of names) {
        const safeId = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
        const subDiv = document.getElementById('sub-' + safeId);
        if (subDiv) {
            await autoExpandFolder(name, subDiv, null);
        }
    }
    updateBucketSelectedCount();
}

async function toggleFoldersExpand(folderName, btn) {
    const safeId = folderName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    const subDiv = document.getElementById('sub-' + safeId);
    if (!subDiv) return;
    
    if (subDiv.style.display === 'block') {
        subDiv.style.display = 'none';
        btn.textContent = '▶';
        return;
    }
    
    await autoExpandFolder(folderName, subDiv, btn);
}

async function autoExpandFolder(folderName, subDiv, btn) {
    subDiv.innerHTML = '<div style="padding:8px 42px;color:var(--text-muted);">加载中...</div>';
    subDiv.style.display = 'block';
    
    try {
        let structure;
        if (folderStructureCache[folderName]) {
            structure = folderStructureCache[folderName];
        } else {
            structure = await fetchAPI(API_BASE + '/buckets/structure?folder=' + encodeURIComponent(folderName));
            if (structure && structure.folders) {
                folderStructureCache[folderName] = structure;
            }
        }
        
        if (!structure || !structure.folders || structure.folders.length === 0) {
            subDiv.innerHTML = '<div style="padding:8px 42px;color:var(--text-muted);font-size:13px;">（内部无子文件夹，全为根级文件）</div>';
            if (btn) btn.textContent = '📄';
            return;
        }
        
        if (btn) btn.textContent = '▼';
        
        const currentFilters = bucketPathFilters[folderName] || [];
        const hasCustomFilter = currentFilters.length > 0;
        
        let shtml = '';
        structure.folders.forEach(f => {
            const checked = hasCustomFilter ? currentFilters.includes(f.name) : true;
            const subPath = folderName + '/' + f.name;
            shtml += `
                <div class="bucket-item-row" style="padding-left: 0;">
                    <label class="bucket-item bucket-sub-item" data-parent="${escapeHtml(folderName)}" style="flex:1;">
                        <input type="checkbox" class="bucket-sub-checkbox" data-parent="${escapeHtml(folderName)}" data-name="${escapeHtml(f.name)}" ${checked ? 'checked' : ''} />
                        <span class="bucket-name">${escapeHtml(f.name)}</span>
                        <span class="bucket-count">${(f.file_count ?? 0).toLocaleString()} 个文件${f.children_count ? ' | ' + f.children_count + '个子目录' : ''}</span>
                    </label>
                    <button class="bucket-root-btn ${bucketRoots.has(subPath) ? 'active' : ''}" 
                        data-root="${escapeHtml(subPath)}"
                        onclick="event.stopPropagation(); setBucketRoot('${escapeHtml(subPath)}', this)" 
                        title="将 '${escapeHtml(f.name)}' 设为桶根">
                        ${bucketRoots.has(subPath) ? '🎯 当前桶根' : '🎯 设为桶根'}
                    </button>
                </div>
            `;
        });
        
        // 全选/全不选 按钮
        if (structure.folders.length > 3) {
            const allSel = hasCustomFilter ? '' : 'checked';
            shtml = `
                <div class="bucket-sub-controls">
                    <label style="cursor:pointer;font-size:12px;">
                        <input type="checkbox" class="bucket-sub-all" data-parent="${escapeHtml(folderName)}" ${allSel} onchange="toggleSubAll(this)" /> 全选
                    </label>
                </div>
            ` + shtml;
        }
        
        subDiv.innerHTML = shtml;
    } catch (error) {
        subDiv.innerHTML = '<div style="padding:8px 42px;color:var(--accent-red);">加载失败: ' + error.message + '</div>';
    }
}

function toggleSubAll(checkbox) {
    const parent = checkbox.dataset.parent;
    document.querySelectorAll('.bucket-sub-checkbox[data-parent="' + parent + '"]').forEach(cb => {
        cb.checked = checkbox.checked;
    });
}

function toggleBucketGroup(header) {
    const children = header.nextElementSibling;
    const arrow = header.querySelector('.bucket-group-arrow');
    if (children.style.display === 'none') {
        children.style.display = 'block';
        arrow.textContent = '▼';
    } else {
        children.style.display = 'none';
        arrow.textContent = '▶';
    }
}

function toggleGroupChildren(groupCheckbox) {
    const decade = groupCheckbox.dataset.decade;
    const checked = groupCheckbox.checked;
    document.querySelectorAll('.bucket-checkbox[data-decade="' + decade + '"]').forEach(cb => {
        cb.checked = checked;
    });
    updateBucketSelectedCount();
}

function setAllBuckets(checked) {
    document.querySelectorAll('.bucket-checkbox').forEach(cb => cb.checked = checked);
    document.querySelectorAll('.bucket-group-checkbox').forEach(gcb => gcb.checked = checked);
    updateBucketSelectedCount();
}

function invertBuckets() {
    document.querySelectorAll('.bucket-checkbox').forEach(cb => cb.checked = !cb.checked);
    document.querySelectorAll('.bucket-group-checkbox').forEach(gcb => {
        const decade = gcb.dataset.decade;
        const children = document.querySelectorAll('.bucket-checkbox[data-decade="' + decade + '"]');
        const allChecked = Array.from(children).every(c => c.checked);
        const someChecked = Array.from(children).some(c => c.checked);
        gcb.checked = allChecked;
    });
    updateBucketSelectedCount();
}

function updateBucketSelectedCount() {
    const checked = document.querySelectorAll('.bucket-checkbox:checked').length;
    const total = document.querySelectorAll('.bucket-checkbox').length;
    document.getElementById('bucketSelectedCount').textContent = checked + ' / ' + total;
    
    document.querySelectorAll('.bucket-group-checkbox').forEach(gcb => {
        const decade = gcb.dataset.decade;
        const children = document.querySelectorAll('.bucket-checkbox[data-decade="' + decade + '"]');
        if (children.length === 0) return;
        gcb.checked = Array.from(children).every(c => c.checked);
    });
}

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('bucket-checkbox')) {
        updateBucketSelectedCount();
    }
});

function setBucketRoot(folderName, btn) {
    if (bucketRoots.has(folderName)) {
        bucketRoots.delete(folderName);
    } else {
        bucketRoots.add(folderName);
        // 如果是顶层文件夹（无 '/'），自动勾选它的 checkbox
        if (!folderName.includes('/')) {
            const allCbs = document.querySelectorAll('.bucket-checkbox');
            for (const cb of allCbs) {
                if (cb.dataset.name === folderName && !cb.checked) {
                    cb.checked = true;
                    updateBucketSelectedCount();
                    const decade = cb.dataset.decade;
                    if (decade) {
                        const siblings = document.querySelectorAll(`.bucket-checkbox[data-decade="${decade}"]`);
                        const allChecked = Array.from(siblings).every(s => s.checked);
                        const parentCb = document.querySelector(`.decade-checkbox[data-decade="${decade}"]`);
                        if (parentCb) parentCb.checked = allChecked;
                    }
                    break;
                }
            }
        }
    }
    document.querySelectorAll('.bucket-root-btn').forEach(b => {
        if (bucketRoots.has(b.dataset.root)) {
            b.classList.add('active');
            b.textContent = '🎯 当前桶根';
        } else {
            b.classList.remove('active');
            b.textContent = '🎯 设为桶根';
        }
    });
}

async function applyBuckets() {
    const checked = document.querySelectorAll('.bucket-checkbox:checked');
    const selectedNames = Array.from(checked).map(cb => cb.dataset.name);
    const total = document.querySelectorAll('.bucket-checkbox').length;
    
    // 构建 path_filters: 只收集「不是全部选中」的文件夹的子文件夹筛选
    const pathFilters = {};
    const expandedFolders = document.querySelectorAll('.bucket-sub-checkbox[data-parent]');
    if (expandedFolders.length > 0) {
        // 按 parent 分组
        const groups = {};
        expandedFolders.forEach(cb => {
            const parent = cb.dataset.parent;
            if (!groups[parent]) groups[parent] = { total: 0, checked: [] };
            groups[parent].total++;
            if (cb.checked) groups[parent].checked.push(cb.dataset.name);
        });
        
        for (const [parent, info] of Object.entries(groups)) {
            if (info.checked.length > 0 && info.checked.length < info.total) {
                // 部分选中 → 记录筛选
                pathFilters[parent] = info.checked;
            }
            // 全选 → 不记录（加载该桶全部）
            // 全不选 → 不在此列（该桶本身没勾选的情况由 buckets 列表处理）
        }
    }
    
    const buckets = selectedNames.length === total ? [] : selectedNames;
    
    const btn = document.getElementById('applyBuckets');
    btn.disabled = true;
    btn.textContent = '⏳ 应用中...';
    
    try {
        const result = await fetchAPI(API_BASE + '/buckets', {
            method: 'PUT',
            body: JSON.stringify({ 
                buckets: buckets,
                path_filters: Object.keys(pathFilters).length > 0 ? pathFilters : null,
                bucket_roots: bucketRoots.size > 0 ? [...bucketRoots] : null
            }),
        });
        
        if (result) {
            document.getElementById('bucketModal').style.display = 'none';
            alert('✅ ' + result.message + '\n加载条目: ' + (result.total_loaded ?? 0).toLocaleString());
            
            await loadResources();
            await loadStats();
        }
    } catch (error) {
        alert('应用失败: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ 应用并刷新';
    }
}
