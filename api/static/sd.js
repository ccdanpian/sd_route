// import { openPreviewWindow } from './inpaint.js';

// 确保正确导入 openPreviewWindow 函数
import { openPreviewWindow } from './inpaint.js';

// 如果 apiUrl 是在 sd.js 中定义的，需要导出它以供 inpaint.js 使用
export const apiUrl = '';  // 替换为实际的 API URL

const DEBUG_MODE = false;  // 设置为 true 开启调试模式
let currentTaskId = null;
let taskQueue = [];
let statusCheckInterval = null;
const taskDisplayStatus = {};

let generateBtn;

document.addEventListener('DOMContentLoaded', function() {
    // 将所有的初始化代码和事件监听器放在这里
    generateBtn = document.getElementById('sd-generate-btn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateImages);
    } else {
        console.error('未找到 sd-generate-btn 元素');
    }
    // ... 其他初始化代码 ...
});

async function generateImages() {
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
        negative_prompt: "NSFW",  // 默认负面提示词
        width: width,
        height: height,
        num_images: parseInt(document.getElementById('sd-num-images').value),
        seed: parseInt(document.getElementById('sd-seed').value),
        lora: loraValue !== "",  // 布尔值，表示是否使用Lora
        lora_name: loraValue,  // Lora的名称
        lora_weight: parseFloat(document.getElementById('sd-lora-weight').value)  // Lora权重
    };

    // 如果没有选择Lora，则删除相关参数
    if (!params.lora) {
        delete params.lora_name;
        delete params.lora_weight;
    }

    try {
        updateStatus("正在提交任务...");
        const response = await fetch(`${apiUrl}/sd/generate`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        const text = await response.text();  // Get response as text
        try {
            const data = JSON.parse(text);  // Try to parse JSON
            if (!response.ok) {
                if (response.status === 400 && data.error) {
                    updateStatus(data.error);
                } else if (response.status === 429) {
                    updateStatus(data.error || "排队已满，请稍后再试");
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return;
            }

            if (data.task_id) {
                addToQueue(data.task_id, data.queuePosition);
                await checkStatus(data.task_id);
            } else {
                updateStatus("生成失败：未收到任务ID");
            }
        } catch (jsonError) {
            console.error('Error parsing JSON:', jsonError);
            console.error('Response text:', text);  // Log the response text
            updateStatus("生成失败：服务器返回无效的JSON");
        }
    } catch (error) {
        console.error('Error:', error);
        updateStatus("生成失败：" + error.message);
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

    const taskContainer = document.getElementById('sd-task-container');
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

    fileNames.forEach((fileName, index) => {
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'image-wrapper';

        const img = document.createElement('img');
        img.src = `${apiUrl}/images/sd/${taskId}/${fileName}`;
        img.alt = '生成的图像';
        img.className = 'sd-image';
        img.dataset.taskId = taskId;
        img.addEventListener('click', () => openPreviewWindow(img.src, taskId));

        const seedInfo = document.createElement('div');
        seedInfo.textContent = `种子：${seeds[index]}`;

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
