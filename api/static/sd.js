console.debug('sd.js 文件开始执行');

import { openPreviewWindow } from './inpaint.js';
import { apiRequest, setToken, clearToken } from './api.js';

export const apiUrl = '';  // 替换为实际的 API URL

const DEBUG_MODE = true;  // 设置为 true 以启用更多日志
let currentTaskId = null;
let taskQueue = [];
let statusCheckInterval = null;
const taskDisplayStatus = {};

let generateBtn;
let isAuthenticated = false;

console.debug('sd.js 模块开始加载');  // 使用 console.debug 替代 console.log

export function checkAuthStatus() {
    console.log('正在检查认证状态');
    const token = getCookie('access_token') || localStorage.getItem('access_token');
    if (token) {
        console.log('找到访问令牌');
        localStorage.setItem('access_token', token);  // 将 token 保存到 localStorage 中
        setToken(token);
        fetchUserInfo();
    } else {
        console.log('未找到访问令牌，显示登录按钮');
        showLoginButton();
    }
}

function showLoginButton() {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = '<button id="login-btn">登录</button>';
        document.getElementById('login-btn').addEventListener('click', login);
    } else {
        console.error('未找到 auth-section 元素');
    }
}

export function login() {
    console.debug('执行登录');
    window.location.href = `${apiUrl}/login`;
}

function logout() {
    console.debug('Logging out...');
    apiRequest('/logout', 'GET')
        .then(data => {
            if (data.success) {
                console.debug('Logout successful');
                clearToken();
                localStorage.removeItem('access_token');
                isAuthenticated = false;
                showLoginButton();
                updateUIForAuth();
            } else {
                console.error('Logout was not successful:', data);
            }
        })
        .catch(error => {
            console.error('Logout error:', error);
        });
}

function fetchUserInfo() {
    console.debug('获取用户信息');
    apiRequest('/user/info', 'GET')
        .then(data => {
            if (data.error) {
                console.error('获取用户信息失败:', data.error);
                throw new Error(data.error);
            }
            console.debug('成功获取用户信息:', data);
            isAuthenticated = true;
            updateUIForAuth(data);
            displayUserInfo(data);
        })
        .catch(error => {
            console.error('获取用户信息时出错:', error);
            isAuthenticated = false;
            updateUIForAuth();
            showLoginButton();
        });
}

function displayUserInfo(userData) {
    const authSection = document.getElementById('auth-section');
    if (authSection) {
        authSection.innerHTML = `
            <span>欢迎, ${userData.name || userData.username}!</span>
            <button id="logout-btn">登出</button>
        `;
        document.getElementById('logout-btn').addEventListener('click', logout);
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
    console.debug('尝试生成图像');
    if (!isAuthenticated) {
        console.warn('用户未认证，显示提醒');
        alert('请先登录');
        return;
    }

    if (!generateBtn) {
        console.error('generateBtn 未定义');
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

    try {
        updateStatus("正在提交任务...");
        const data = await apiRequest('/sd/generate', 'POST', params);
        
        console.log('API 响应:', data);  // 添加这行来看 API 响应

        if (data.task_id) {
            addToQueue(data.task_id, data.queuePosition);
            await checkStatus(data.task_id);
        } else {
            updateStatus("生成失败：未收到任务ID");
        }
    } catch (error) {
        console.error('错误:', error);
        if (error.status === 401) {
            updateStatus("需要认证，请登录");
            showLoginButton();
        } else if (error.status === 400) {
            updateStatus(error.message || "请求参数错误");
        } else if (error.status === 429) {
            updateStatus(error.message || "排队已满，请稍后再试");
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

function addToQueue(taskId, queuePosition) {
    taskQueue.push(taskId);
    taskDisplayStatus[taskId] = false; // 初始化任务显示状态
    createTaskStatusElement(taskId, queuePosition);
    updateStatus(`已添加到队列，当前位置：${queuePosition + 1}`);
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

function createTaskStatusElement(taskId, queuePosition) {
    if (!DEBUG_MODE) return;

    const taskContainer = document.getElementById('sd-status-container');
    const taskElement = document.createElement('div');
    taskElement.id = `sd-task-${taskId}`;
    taskElement.innerHTML = `
        <div class="task-status">任务ID: ${taskId}</div>
        <div class="imageContainer"></div>
    `;
    taskContainer.appendChild(taskElement);
}

function startStatusCheck(taskId) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = setInterval(() => checkStatus(taskId), 5000);
}

async function checkStatus(taskId) {
    try {
        const response = await fetch(`${apiUrl}/sd/status/${taskId}`);
        const data = await response.json();

        updateTaskElement(taskId, data);
        updateStatus(getStatusMessage(data.status, data.queuePosition));

        if (data.status === "完成" && !taskDisplayStatus[taskId]) {
            if (data.file_names && data.seeds && data.translated_prompt) {
                displayImages(taskId, data.file_names, data.seeds, data.translated_prompt);
                taskDisplayStatus[taskId] = true; // 标记该任务的图片已显示
            }
            finishCurrentTask();
        } else if (data.status.startsWith("失败")) {
            finishCurrentTask();
        } else if (data.status !== "完成") {
            // 继续检查状态
            setTimeout(() => checkStatus(taskId), 5000);
        }
    } catch (error) {
        console.error('Error:', error);
        updateStatus("状态查询失败");
        finishCurrentTask();
    }
}

function updateTaskElement(taskId, data) {
    if (!DEBUG_MODE) return;

    const taskElement = document.getElementById(`sd-task-${taskId}`);
    if (taskElement) {
        const statusElement = taskElement.querySelector('.task-status');
        if (statusElement) {
            statusElement.textContent = `任务ID: ${taskId} - 状态: ${data.status}`;
        }
    }
    
    // 始终更新全局状态
    updateStatus(getStatusMessage(data.status, data.queuePosition));
}

function getStatusMessage(status, queuePosition) {
    switch (status) {
        case "排队中":
            return `正在排队，当前位置：${queuePosition + 1}`;
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

function updateStatus(message) {
    const statusContainer = document.getElementById('sd-status-container');
    if (statusContainer) {
        statusContainer.textContent = `状态：${message}`;
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
        // 设置图片的最大宽度，确保它们不会太大
        img.style.maxWidth = '100%';
        img.style.height = 'auto';

        const seedInfo = document.createElement('div');
        seedInfo.textContent = `种子：${seeds[index]}`;
        seedInfo.style.marginTop = '5px'; // 为种子信息添加一些上边距

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
