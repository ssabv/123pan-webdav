// 全局状态
let currentPage = 1;
let pageSize = 50;
let currentSearch = '';
let totalPages = 1;
let currentDeleteHash = null;

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
            document.getElementById('stat-total').textContent = stats.total.toLocaleString();
            document.getElementById('stat-public').textContent = stats.public.toLocaleString();
            document.getElementById('stat-private').textContent = stats.private.toLocaleString();
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
    if (!file.name.endsWith('.json')) {
        alert('请选择 JSON 文件');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            importData = JSON.parse(e.target.result);
            showImportPreview(importData);
        } catch (error) {
            alert('JSON 解析失败: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// 显示导入预览
function showImportPreview(data) {
    const preview = document.getElementById('importPreview');
    const content = document.getElementById('previewContent');
    
    const filesCount = data.files ? data.files.length : 0;
    const totalSize = data.totalSize || 0;
    
    content.innerHTML = `
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
        const result = await fetchAPI(`${API_BASE}/resources/import`, {
            method: 'POST',
            body: JSON.stringify(importData),
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
            
            // 刷新列表
            loadResources();
            loadStats();
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
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadResources();
        loadStats();
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
    loadStats();
    loadResources();
});
