console.debug('sd.js 文件开始执行');

import { openPreviewWindow } from './inpaint.js';
import { apiRequest, setToken, clearToken } from './api.js';

export const apiUrl = '';  // 替换为实际的 API URL

const DEBUG_MODE = false;  // 设置为 true 以启用更多日志
let currentTaskId = null;
let taskQueue = [];
let statusCheckInterval = null;
const taskDisplayStatus = {};

let generateBtn;
let isAuthenticated = false;

console.debug('sd.js 模块开始加载');  // 使用 console.debug 替代 console.log

export function checkAuthStatus() {
    console.log('正在检查认证状态');
    updateDebugLog('正在检查认证状态');
    
    setTimeout(() => {
        const token = getCookie('jwt_token') || localStorage.getItem('jwt_token');
        if (token) {
            console.log('找到访问令牌');
            updateDebugLog('找到访问令牌');
            localStorage.setItem('access_token', token);
            setToken(token);
            fetchUserInfo();
        } else {
            console.log('未找到访问令牌，显示登录按钮');
            updateDebugLog('未找到访问令牌显示登录按钮');
            showLoginButton();
        }
    }, 500); // 500ms 延迟
}

function showLoginButton() {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        // 确保先清除现有的用户信息
        clearUserInfo();
        
        const loginButton = document.createElement('button');
        loginButton.id = 'login-btn';
        loginButton.textContent = '登录';
        loginButton.addEventListener('click', login);
        authSection.appendChild(loginButton);
    } else {
        console.error('未找到 auth-section 元素');
    }
}

export function login() {
    console.debug('执行登录');
    window.location.href = `${apiUrl}/login`;
}

function logout() {
    console.debug('正在登出...');
    apiRequest('/logout', 'GET')
        .then(data => {
            if (data.success) {
                console.debug('登出成功:', data.message);
                clearToken();
                localStorage.removeItem('access_token');
                isAuthenticated = false;
                clearUserInfo();
                showLoginButton();
                updateUIForAuth();
            } else {
                console.warn('登出部分成功:', data.message);
                updateDebugLog('登出警告:', data.message);
                // 即使部分成功，也清理本地状态
                clearToken();
                localStorage.removeItem('access_token');
                isAuthenticated = false;
                clearUserInfo();
                showLoginButton();
                updateUIForAuth();
            }
        })
        .catch(error => {
            console.error('登出错误:', error);
            updateDebugLog('登出错误:', error.message);
            // 即使发生错误，也尝试清理本地状态
            clearToken();
            localStorage.removeItem('access_token');
            isAuthenticated = false;
            clearUserInfo();
            showLoginButton();
            updateUIForAuth();
        });
}

function clearUserInfo() {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        const userInfo = authSection.querySelector('.user-info');
        if (userInfo) {
            userInfo.remove(); // 移除整个 user-info div
        }
    } else {
        console.error('未找到 auth-section 元素');
    }
}

function fetchUserInfo() {
    console.debug('获取用户信息');
    apiRequest('/user/info', 'GET')
        .then(data => {
            if (data.error) {
                console.error('获取用户信息失败:', data.error);
                updateDebugLog('获取用户信息失败:', data.error);
                throw new Error(data.error);
            }
            console.debug('成功获取用户信息:', data);
            updateDebugLog('成功获取用户信息:', data);
            isAuthenticated = true;
            updateUIForAuth(data);
            displayUserInfo(data);
        })
        .catch(error => {
            console.error('获取用户信息时出错:', error);
            updateDebugLog('获取用户信息时出错:', error);
            isAuthenticated = false;
            updateUIForAuth();
            showLoginButton();
        });
}

function displayUserInfo(userData) {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = `
            <div class="user-info-container">
                <div class="avatar-container">
                    <img class="avatar" src="${userData.avatar_url}" alt="头像">
                </div>
                <div class="user-details">
                    <span class="username">${userData.name || userData.username}</span>
                    <button id="logout-btn">登出</button>
                </div>
            </div>
        `;
        
        const userInfoContainer = authSection.querySelector('.user-info-container');
        const avatarContainer = authSection.querySelector('.avatar-container');
        
        avatarContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            userInfoContainer.classList.toggle('expanded');
        });
        
        document.addEventListener('click', () => {
            userInfoContainer.classList.remove('expanded');
        });
        
        document.getElementById('logout-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            logout();
        });
    } else {
        console.error('未找到 auth-section 元素');
    }
}

function updateUIForAuth() {
    console.debug('更新UI认证状态, isAuthenticated:', isAuthenticated);
    if (generateBtn) {
        generateBtn.disabled = !isAuthenticated;
        console.debug('生成按钮状态:', generateBtn.disabled ? '禁用' : '启用');
    } else {
        console.error('生成按钮未找到');
    }
}

export function handleCallback() {
    console.debug('Handling OAuth callback');
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
        console.debug('Authorization code received:', code);
        apiRequest(`/auth/callback?code=${code}`, 'GET')
            .then(data => {
                if (data.success) {
                    console.debug('OAuth callback successful');
                    localStorage.setItem('access_token', data.access_token);
                    setToken(data.access_token);
                    fetchUserInfo();
                } else {
                    console.error('OAuth callback was not successful:', data);
                    showLoginButton();
                }
            })
            .catch(error => {
                console.error('Error handling callback:', error);
                showLoginButton();
            });
    } else {
        console.warn('No authorization code found in URL');
    }
}

export function initSD() {
    console.debug('初始化SD模块');
    initDebugMode(); // 添加这行
    generateBtn = document.getElementById('sd-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateImages);
        console.debug('已添加生成按钮事件监听器');
    } else {
        console.error('在DOM中未找到生成按钮');
    }
    checkAuthStatus();
}

async function generateImages() {
    updateDebugLog('尝试生成图像');
    if (!isAuthenticated) {
        updateDebugLog('用户未认证，显示提醒');
        alert('请先登录');
        return;
    }

    if (!generateBtn) {
        updateDebugLog('generateBtn 未定义');
        return;
    }
    generateBtn.disabled = true;
    clearPreviousImages();

    const [width, height] = document.getElementById('sd-size').value.split('x').map(Number);
    const loraValue = document.getElementById('sd-lora').value;

    const params = {
        prompt: document.getElementById('sd-prompt').value,
        negative_prompt: "NSFW",
        width: width,
        height: height,
        num_images: parseInt(document.getElementById('sd-num-images').value),
        steps: parseInt(document.getElementById('sd-steps').value),
        seed: parseInt(document.getElementById('sd-seed').value),
        lora: loraValue !== "",
        lora_name: loraValue,
        lora_weight: parseFloat(document.getElementById('sd-lora-weight').value)
    };

    if (!params.lora) {
        delete params.lora_name;
        delete params.lora_weight;
    }

    updateDebugLog(`请求参数: ${JSON.stringify(params)}`);

    try {
        updateStatus("正在提交任务...");
        const response = await apiRequest('/sd/generate', 'POST', params);
        
        updateDebugLog(`API 响应: ${JSON.stringify(response)}`);

        if (response.error) {
            updateDebugLog(`API 返回错误: ${response.error}`);
            updateStatus(`生成失败：${response.error}`);
            return;
        }

        if (!response.task_id) {
            updateDebugLog(`响应中没有 task_id: ${JSON.stringify(response)}`);
            throw new Error('未收到任务ID');
        }

        updateDebugLog(`成功接收到任务 ID: ${response.task_id}`);
        addToQueue(response.task_id, response.queuePosition, response.max_queue_size);
        await checkStatus(response.task_id);

    } catch (error) {
        updateDebugLog(`成图像时发生错误: ${error.message}`);
        if (error.response && error.response.error) {
            updateStatus(`生成失败：${error.response.error}`);
        } else {
            updateStatus("生成失败：" + (error.message || "未知错误"));
        }
    } finally {
        generateBtn.disabled = false;
    }
}

function clearPreviousImages() {
    const container = document.getElementById('sd-result-container');
    if (container) {
        container.innerHTML = '';
    } else {
        console.warn('未找到 sd-result-container 元素');
    }
}

function addToQueue(taskId, queuePosition, maxQueueSize) {
    taskQueue.push(taskId);
    taskDisplayStatus[taskId] = false; // 初始化任务显示状态
    createTaskStatusElement(taskId, queuePosition, maxQueueSize);
    updateStatus("排队中", queuePosition, maxQueueSize);
    if (!currentTaskId) {
        processNextTask();
    }
}

function processNextTask() {
    if (taskQueue.length > 0) {
        currentTaskId = taskQueue.shift();
        if (!taskDisplayStatus[currentTaskId]) {
            startStatusCheck(currentTaskId);
        }
    }
}

function createTaskStatusElement(taskId, queuePosition, maxQueueSize) {
    if (!DEBUG_MODE) return;

    const taskContainer = document.getElementById('sd-status-container');
    const taskElement = document.createElement('div');
    taskElement.id = `sd-task-${taskId}`;
    taskElement.innerHTML = `
        <div class="task-status">任务ID: ${taskId} - 队列位置: ${queuePosition + 1}/${maxQueueSize}</div>
        <div class="imageContainer"></div>
    `;
    taskContainer.appendChild(taskElement);
}

function startStatusCheck(taskId) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = setInterval(() => checkStatus(taskId), 10000);
}

async function checkStatus(taskId) {
    try {
        const response = await apiRequest(`/sd/status/${taskId}`, 'GET');
        updateDebugLog(`任务 ${taskId} 状态更新: ${JSON.stringify(response)}`);

        updateTaskElement(taskId, response);
        updateStatus(response.status, response.queuePosition, response.max_queue_size);

        if (response.status === "完成" && !taskDisplayStatus[taskId]) {
            if (response.file_names && response.seeds && response.translated_prompt) {
                displayImages(taskId, response.file_names, response.seeds, response.translated_prompt);
                taskDisplayStatus[taskId] = true;
            }
            finishCurrentTask();
        } else if (response.status.startsWith("失败")) {
            updateDebugLog(`任务 ${taskId} 失败: ${response.error || '未知错误'}`);
            updateStatus(`生成失败：${response.error || '未知错误'}`);
            finishCurrentTask();
        } else if (response.status !== "完成") {
            setTimeout(() => checkStatus(taskId), 10000);
        }
    } catch (error) {
        updateDebugLog(`查任务 ${taskId} 状态时出错: ${error.message}`);
        updateStatus("状态查询失败：" + (error.message || "未知错误"));
        finishCurrentTask();
    }
}

function updateTaskElement(taskId, data) {
    if (!DEBUG_MODE) return;

    const taskElement = document.getElementById(`sd-task-${taskId}`);
    if (taskElement) {
        const statusElement = taskElement.querySelector('.task-status');
        if (statusElement) {
            statusElement.textContent = `任务ID: ${taskId} - 状态: ${data.status} - 队列位置: ${data.queuePosition + 1}/${data.max_queue_size}`;
        }
    }
    
    // 始终更新全局状态
    // updateStatus(data.status, data.queuePosition, data.max_queue_size);
}

function getStatusMessage(status, queuePosition, maxQueueSize) {
    switch (status) {
        case "排队中":
            return `正在排队，当前位置：${queuePosition + 1}/${maxQueueSize}`;
        case "处理中":
            return "正在生成图片";
        case "完成":
            return "图片生成完成";
        default:
            return status.startsWith("失败") ? "生成失败：" + status : status;
    }
}

function finishCurrentTask() {
    clearInterval(statusCheckInterval);
    currentTaskId = null;
    processNextTask();
}

function updateStatus(message, queuePosition, maxQueueSize) {
    const statusContainer = document.getElementById('sd-status-container');
    if (statusContainer) {
        let statusText = '';
        
        if (message === "排队中" && queuePosition !== undefined) {
            statusText = `状态：正在排队，当前位置：${queuePosition + 1}/${maxQueueSize}`;
        } else if (typeof message === 'object' && message.error) {
            // 处理错误对
            statusText = `状态：生成失败：${message.error}`;
        } else {
            statusText = `状态：${message}`;
        }
        
        statusContainer.textContent = statusText;
    } else {
        console.error('未找到 sd-status-container 元素');
    }
}

function displayImages(taskId, fileNames, seeds, translatedPrompt) {
    const sdResultContainer = document.getElementById('sd-result-container');
    sdResultContainer.innerHTML = ''; // Clear previous results

    const promptElement = document.createElement('p');
    promptElement.textContent = translatedPrompt;
    sdResultContainer.appendChild(promptElement);

    const imageContainer = document.createElement('div');
    imageContainer.className = 'container_images_sd';
    imageContainer.dataset.taskId = taskId;
    // 添加 Flexbox 样式
    imageContainer.style.display = 'flex';
    imageContainer.style.flexWrap = 'wrap';
    imageContainer.style.justifyContent = 'center';
    imageContainer.style.gap = '10px'; // 设置图片之间的间距

    fileNames.forEach((fileName, index) => {
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'image-wrapper';
        // 设置图片包装器的样式
        imageWrapper.style.display = 'flex';
        imageWrapper.style.flexDirection = 'column';
        imageWrapper.style.alignItems = 'center';

        const img = document.createElement('img');
        img.src = `${apiUrl}/images/sd/${taskId}/${fileName}`;
        img.alt = '生成的图像';
        img.className = 'sd-image';
        img.dataset.taskId = taskId;
        img.addEventListener('click', () => openPreviewWindow(img.src, taskId));
        // 设置片的最大宽度，确保它们不会太大
        img.style.maxWidth = '100%';
        img.style.height = 'auto';

        const seedInfo = document.createElement('div');
        seedInfo.textContent = `种子：${seeds[index]}`;
        seedInfo.style.marginTop = '5px'; // 为种信息添加一些上边距

        imageWrapper.appendChild(img);
        imageWrapper.appendChild(seedInfo);
        imageContainer.appendChild(imageWrapper);
    });

    sdResultContainer.appendChild(imageContainer);

    if (DEBUG_MODE) {
        // 更新 SD 容器中的图片（仅在调试模式下）
        const taskElement = document.getElementById(`sd-task-${taskId}`);
        if (taskElement) {
            const debugImageContainer = taskElement.querySelector('.imageContainer');
            debugImageContainer.innerHTML = imageContainer.innerHTML;
        }
    }
}

// 辅助函数：获取 cookie 值
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// 在文件末尾添加初始化代码
document.addEventListener('DOMContentLoaded', function() {
    console.debug('DOM 内容已加载，开始初始化 SD 模块');
    initSD();
});

console.debug('sd.js 模块加载完成');

// 在 sd.js 文件末尾
window.checkAuthStatus = checkAuthStatus;

function updateDebugLog(message) {
    if (DEBUG_MODE) {
        const logElement = document.getElementById('debug-log');
        if (logElement) {
            const timestamp = new Date().toISOString();
            logElement.value += `${timestamp}: ${message}\n`;
            logElement.scrollTop = logElement.scrollHeight;
        }
        console.debug(message); // 在调试模式下也输出到控制台
    }
}

// 在文件开头或初始化函数中添加这段代码
function initDebugMode() {
    const debugLogElement = document.getElementById('debug-log');
    if (debugLogElement) {
        debugLogElement.style.display = DEBUG_MODE ? 'block' : 'none';
    }
}
