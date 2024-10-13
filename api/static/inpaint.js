// Global variables
let selectedImage = null;
let maskImage = null;
let isDrawing = false;
let originalImageData = null;
let drawMode = 'rectangle';  // 默认为矩形模式
let startX, startY;
let originalImage = null; // 新增全局变量来存储真正的原始图片

const apiUrl = window.location.origin;
const baseUrl = window.location.origin;

let statusTimeout;

export function openPreviewWindow(src, taskId) {
    // 使用传入的 taskId，而不是全局变量
    
    const previewWindow = document.createElement('div');
    previewWindow.id = 'previewWindow';
    previewWindow.style.position = 'fixed';
    previewWindow.style.top = '0';
    previewWindow.style.left = '0';
    previewWindow.style.width = '100%';
    previewWindow.style.height = '100%';
    previewWindow.style.backgroundColor = 'rgba(0,0,0,0.8)';
    previewWindow.style.display = 'flex';
    previewWindow.style.flexDirection = 'column';
    previewWindow.style.justifyContent = 'center';
    previewWindow.style.alignItems = 'center';
    previewWindow.style.zIndex = '1000';

    const canvas = document.createElement('canvas');
    canvas.id = 'editCanvas';
    canvas.style.maxWidth = '80%';
    canvas.style.maxHeight = '70%';
    canvas.style.border = '1px solid #ccc';

    const promptContainer = document.createElement('div');
    promptContainer.style.display = 'flex';
    promptContainer.style.alignItems = 'center';
    promptContainer.style.marginBottom = '10px';

    const promptInput = document.createElement('input');
    promptInput.type = 'text';
    promptInput.placeholder = '输入重绘 prompt';
    promptInput.style.padding = '5px';
    promptInput.style.width = '300px';
    promptInput.style.marginRight = '10px';

    const sendButton = createButton('发送重绘', () => {
        document.body.removeChild(previewWindow);  // 关闭预览窗口
        sendMaskedImage(promptInput.value);
    });

    promptContainer.appendChild(promptInput);
    promptContainer.appendChild(sendButton);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '20px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';

    const closeButton = createButton('关闭', () => document.body.removeChild(previewWindow));
    const toggleModeButton = createButton('矩形MASK', () => {
        drawMode = drawMode === 'rectangle' ? 'freeform' : 'rectangle';
        toggleModeButton.textContent = drawMode === 'rectangle' ? '矩形MASK' : '自由MASK';
    });
    toggleModeButton.style.padding = '10px 20px';
    toggleModeButton.style.fontSize = '16px';
    toggleModeButton.style.backgroundColor = '#4CAF50';
    toggleModeButton.style.color = 'white';
    toggleModeButton.style.border = 'none';
    toggleModeButton.style.borderRadius = '5px';
    toggleModeButton.style.cursor = 'pointer';
    const resetButton = createButton('重置蒙版', resetMask);
    const saveMaskButton = createButton('保存蒙版', saveMask);

    buttonContainer.appendChild(closeButton);
    buttonContainer.appendChild(toggleModeButton);
    buttonContainer.appendChild(resetButton);
    buttonContainer.appendChild(saveMaskButton);

    previewWindow.appendChild(promptContainer);
    previewWindow.appendChild(canvas);
    previewWindow.appendChild(buttonContainer);

    document.body.appendChild(previewWindow);

    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        originalImage = img; // 保存真正的原始图片
        maskImage = document.createElement('canvas');  // 使用全局变量 maskImage
        maskImage.width = canvas.width;
        maskImage.height = canvas.height;
        resetMask();
    };
    img.src = src;

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // 添加触摸事件支持
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);
}

function createButton(text, onClick) {
    const button = document.createElement('button');
    button.textContent = text;
    button.onclick = onClick;
    return button;
}

function startDrawing(e) {
    isDrawing = true;
    const rect = e.target.getBoundingClientRect();
    startX = (e.clientX || e.touches[0].clientX) - rect.left;
    startY = (e.clientY || e.touches[0].clientY) - rect.top;

    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'freeform') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        maskCtx.beginPath();
        maskCtx.moveTo(startX, startY);
    }
}

function draw(e) {
    if (!isDrawing) return;
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;

    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'rectangle') {
        ctx.putImageData(originalImageData, 0, 0);
        ctx.strokeStyle = 'white';
        ctx.strokeRect(startX, startY, x - startX, y - startY);
    } else {
        // 在 maskImage 上绘制
        maskCtx.lineTo(x, y);
        maskCtx.stroke();
        
        // 在 canvas 上实时显示轨迹
        ctx.putImageData(originalImageData, 0, 0);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(maskImage, 0, 0);
        ctx.globalAlpha = 1.0;
        
        // 在 canvas 上绘制当前笔画
        ctx.strokeStyle = 'white';
        ctx.lineTo(x, y);
        ctx.stroke();
    }
}

function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'rectangle') {
        const rect = canvas.getBoundingClientRect();
        const endX = (e.clientX || (e.changedTouches && e.changedTouches[0].clientX)) - rect.left;
        const endY = (e.clientY || (e.changedTouches && e.changedTouches[0].clientY)) - rect.top;
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(startX, startY, endX - startX, endY - startY);
    } else {
        maskCtx.closePath();
        maskCtx.fillStyle = 'white';
        maskCtx.fill();
    }

    ctx.putImageData(originalImageData, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(maskImage, 0, 0);
    ctx.globalAlpha = 1.0;
}

function resetMask() {
    if (!maskImage) {
        console.error('maskImage is not initialized');
        return;
    }
    const maskCtx = maskImage.getContext('2d');
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskImage.width, maskImage.height);
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    ctx.putImageData(originalImageData, 0, 0);
}

async function sendMaskedImage(inpaintPrompt) {
    if (!maskImage || !originalImage) {
        console.error('maskImage or originalImage is not initialized');
        updateStatus("重绘失败：图像未初始化");
        return;
    }

    showLoadingIndicator();

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalImage.width;
    tempCanvas.height = originalImage.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(originalImage, 0, 0);
    const originalImageData = tempCanvas.toDataURL('image/png');

    const maskedImageData = maskImage.toDataURL('image/png');
    
    try {
        const response = await fetch(`${apiUrl}/sd/inpaint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                original_image: originalImageData,
                mask_image: maskedImageData,
                prompt: inpaintPrompt
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Inpaint response:', result);  // 添加日志
        const newTaskId = result.task_id;  // 获取新的 task_id
        if (newTaskId) {
            await pollTaskStatus(newTaskId);
        } else {
            throw new Error('No task ID returned from server');
        }
    } catch (error) {
        console.error('Error:', error);
        hideLoadingIndicator();
        updateStatus("重绘失败：" + error.message);
    }
}
async function pollTaskStatus(taskId) {
    const pollInterval = 2000; // 每2秒轮询一次
    const maxAttempts = 30; // 最多轮询30次（1分钟）
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const response = await fetch(`${apiUrl}/sd/task_status/${taskId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            console.log(`Task status (attempt ${attempts + 1}):`, result);

            if (result.status === '重绘完成') {
                console.log('重绘任务完成，处理结果');
                hideLoadingIndicator();  // 添加这行
                processTaskResult(result);
                return;
            } else if (result.status === '重绘失败') {
                console.error('重绘任务失败:', result.error);
                throw new Error(result.error || "重绘任务失败");
            } else if (result.status === '未知任务') {
                console.warn(`未知任务 ID: ${taskId}`);
                updateStatus("重绘失败：未知任务");
                return;
            }

            // 如果任务仍在进行中，更新进度
            console.log(`重绘进度: ${result.progress}%`);
            updateStatus(`重绘处理中：${result.status} (${result.progress}%)`);

            // 等待一段时间后再次轮询
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            attempts++;
        } catch (error) {
            console.error('轮询错误:', error);
            hideLoadingIndicator();
            updateStatus("重绘失败：" + error.message);
            return;
        }
    }

    // 如果达到最大尝试次数仍未完成，视为超时
    console.error('重绘任务超时');
    hideLoadingIndicator();
    updateStatus("重绘失败：任务超时");
}
function processTaskResult(result) {
    console.log('处理重绘任务结果:', result);
    hideLoadingIndicator();
    if (result.inpainted_image_url) {
        console.log('显示重绘结果图片:', result.inpainted_image_url);
        displayInpaintedImage(result.inpainted_image_url, result.inpaint_prompt);
        updateStatus("重绘完成", 5000);  // 显示5秒
    } else {
        console.error('重绘结果中没有图片URL');
        updateStatus("重绘失败：未获取到结果图片", 5000);  // 显示5秒
    }
}

function displayInpaintedImage(imageUrl, inpaintPrompt) {
    console.log('显示重绘图片:', imageUrl);
    console.log('重绘提示:', inpaintPrompt);
    const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${baseUrl}${imageUrl}`;
    
    // 创建重绘结果容器
    let resultContainer = document.getElementById('inpaintResultContainer');
    if (!resultContainer) {
        resultContainer = document.createElement('div');
        resultContainer.id = 'inpaintResultContainer';
        resultContainer.style.marginTop = '20px';
        resultContainer.style.border = '1px solid #ccc';
        resultContainer.style.padding = '10px';
        resultContainer.style.borderRadius = '5px';
        
        // 在原图下方插入结果容器
        const originalImage = document.querySelector('img'); // 假设原图是页面中的第一个img元素
        if (originalImage && originalImage.parentNode) {
            originalImage.parentNode.insertBefore(resultContainer, originalImage.nextSibling);
        } else {
            document.body.appendChild(resultContainer);
        }
    }

    // 清空容器
    resultContainer.innerHTML = '';

    // 添加标题
    const title = document.createElement('h3');
    title.textContent = '重绘结果';
    resultContainer.appendChild(title);

    // 添加重绘prompt
    const promptPara = document.createElement('p');
    promptPara.textContent = `重绘Prompt: ${inpaintPrompt}`;
    resultContainer.appendChild(promptPara);

    // 添加重绘图片
    const resultImage = document.createElement('img');
    resultImage.src = fullImageUrl;
    resultImage.style.maxWidth = '100%';
    resultImage.style.display = 'block';
    resultImage.alt = '重绘结果图片';
    resultContainer.appendChild(resultImage);

    // 显示容器
    resultContainer.style.display = 'block';
}

function saveMask() {
    const link = document.createElement('a');
    link.download = 'mask.png';
    link.href = maskImage.toDataURL('image/png');
    link.click();
}

function showLoadingIndicator() {
    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'loadingIndicator';
    loadingIndicator.style.position = 'fixed';
    loadingIndicator.style.top = '0';
    loadingIndicator.style.left = '0';
    loadingIndicator.style.width = '100%';
    loadingIndicator.style.height = '100%';
    loadingIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    loadingIndicator.style.display = 'flex';
    loadingIndicator.style.justifyContent = 'center';
    loadingIndicator.style.alignItems = 'center';
    loadingIndicator.style.zIndex = '1000';

    const spinner = document.createElement('div');
    spinner.style.width = '50px';
    spinner.style.height = '50px';
    spinner.style.border = '5px solid #f3f3f3';
    spinner.style.borderTop = '5px solid #3498db';
    spinner.style.borderRadius = '50%';
    spinner.style.animation = 'spin 1s linear infinite';

    const loadingText = document.createElement('div');
    loadingText.id = 'statusMessage';
    loadingText.textContent = '重绘中，请稍候...';
    loadingText.style.color = 'white';
    loadingText.style.marginTop = '20px';
    loadingText.style.fontSize = '18px';

    const loadingContent = document.createElement('div');
    loadingContent.style.display = 'flex';
    loadingContent.style.flexDirection = 'column';
    loadingContent.style.alignItems = 'center';

    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;

    document.head.appendChild(style);
    loadingContent.appendChild(spinner);
    loadingContent.appendChild(loadingText);
    loadingIndicator.appendChild(loadingContent);
    document.body.appendChild(loadingIndicator);

    // 防止点击事件穿透到下层元素
    loadingIndicator.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
}

// 确保正确导出 openPreviewWindow 函数
// export { openPreviewWindow };

function hideLoadingIndicator() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        document.body.removeChild(loadingIndicator);
    }
}

function updateStatus(message, duration = 5000) {
    console.log('更新状态:', message);
    clearTimeout(statusTimeout);  // 清除之前的定时器

    let statusElement = document.getElementById('statusMessage');
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'statusMessage';
        statusElement.style.position = 'fixed';
        statusElement.style.top = '10px';
        statusElement.style.left = '50%';
        statusElement.style.transform = 'translateX(-50%)';
        statusElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        statusElement.style.color = 'white';
        statusElement.style.padding = '10px';
        statusElement.style.borderRadius = '5px';
        statusElement.style.zIndex = '1001';
        statusElement.style.transition = 'opacity 0.5s ease-in-out';
        document.body.appendChild(statusElement);
    }

    statusElement.textContent = message;
    statusElement.style.display = 'block';
    statusElement.style.opacity = '1';

    // 设置定时器，5秒后淡出消失
    statusTimeout = setTimeout(() => {
        statusElement.style.opacity = '0';
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 500);  // 等待淡出动画完成后隐藏元素
    }, duration);
}

function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const canvas = document.getElementById('editCanvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    startX = (touch.clientX - rect.left) * scaleX;
    startY = (touch.clientY - rect.top) * scaleY;

    isDrawing = true;

    const ctx = canvas.getContext('2d');
    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'freeform') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        maskCtx.beginPath();
        maskCtx.moveTo(startX, startY);
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    if (!isDrawing) return;

    const touch = e.touches[0];
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;

    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'rectangle') {
        ctx.putImageData(originalImageData, 0, 0);
        ctx.strokeStyle = 'white';
        ctx.strokeRect(startX, startY, x - startX, y - startY);
    } else {
        // 在 maskImage 上绘制
        maskCtx.lineTo(x, y);
        maskCtx.stroke();
        
        // 在 canvas 上实时显示轨迹
        ctx.putImageData(originalImageData, 0, 0);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(maskImage, 0, 0);
        ctx.globalAlpha = 1.0;
        
        // 在 canvas 上绘制当前笔画
        ctx.strokeStyle = 'white';
        ctx.lineTo(x, y);
        ctx.stroke();
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    if (!isDrawing) return;
    isDrawing = false;

    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const maskCtx = maskImage.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (drawMode === 'rectangle') {
        const touch = e.changedTouches[0];
        const endX = (touch.clientX - rect.left) * scaleX;
        const endY = (touch.clientY - rect.top) * scaleY;
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(startX, startY, endX - startX, endY - startY);
    } else {
        maskCtx.closePath();
        maskCtx.fillStyle = 'white';
        maskCtx.fill();
    }

    ctx.putImageData(originalImageData, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(maskImage, 0, 0);
    ctx.globalAlpha = 1.0;
}