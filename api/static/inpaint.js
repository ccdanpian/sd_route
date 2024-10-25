// inpaints.js
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

let globalExpandSelect; // 在文件顶部声明

// 在文件顶部添加一个数组来存储绘制历史
let drawHistory = [];

// 在文件顶部定义这个函数
function getCanvasContext(canvas) {
    return canvas.getContext('2d', { willReadFrequently: true });
}

export function openPreviewWindow(src, taskId = null) {
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

    const contentContainer = document.createElement('div');
    contentContainer.style.backgroundColor = 'white';
    contentContainer.style.borderRadius = '10px';
    contentContainer.style.padding = '20px';
    contentContainer.style.maxWidth = '80%';
    contentContainer.style.maxHeight = '90%';
    contentContainer.style.display = 'flex';
    contentContainer.style.flexDirection = 'column';
    contentContainer.style.alignItems = 'center';

    const promptContainer = document.createElement('div');
    promptContainer.style.display = 'flex';
    promptContainer.style.alignItems = 'center';
    promptContainer.style.marginBottom = '10px';
    promptContainer.style.width = '100%';
    promptContainer.style.gap = '10px'; // 添加元素之间的间距

    // 添加扩展选择下拉框
    const expandSelect = document.createElement('select');
    expandSelect.id = 'expandSelect';
    expandSelect.style.padding = '10px';
    expandSelect.style.borderRadius = '5px';
    expandSelect.style.border = '1px solid #ccc';
    expandSelect.style.backgroundColor = 'white';
    expandSelect.style.cursor = 'pointer';

    const expandOptions = [
        { value: '0', text: '无扩图' },
        { value: '0.25', text: '扩4/1' },
        { value: '0.5', text: '扩1/2' },
        { value: '1', text: '扩1倍' }
    ];

    expandOptions.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.text;
        expandSelect.appendChild(optionElement);
    });

    // 创建提示词输入框
    const promptInput = document.createElement('input');
    promptInput.type = 'text';
    promptInput.placeholder = '输入重绘 prompt';
    promptInput.style.padding = '10px';
    promptInput.style.flex = '1';
    promptInput.style.borderRadius = '5px';
    promptInput.style.border = '1px solid #ccc';

    // 创建发送按钮
    const sendButton = createButton('发送');
    sendButton.style.padding = '10px 20px';
    sendButton.style.backgroundColor = '#4CAF50';
    sendButton.style.color = 'white';
    sendButton.style.border = 'none';
    sendButton.style.borderRadius = '5px';
    sendButton.style.cursor = 'pointer';
    sendButton.onclick = () => {
        sendMaskedImage(promptInput.value, expandSelect);
        closePreviewWindow(previewWindow);
    };

    // 按顺序将元素添加到 promptContainer
    promptContainer.appendChild(expandSelect);
    promptContainer.appendChild(promptInput);
    promptContainer.appendChild(sendButton);

    const canvas = document.createElement('canvas');
    canvas.id = 'editCanvas';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = 'calc(100% - 100px)';
    canvas.style.border = '1px solid #ccc';
    canvas.style.borderRadius = '5px';

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'space-between';
    buttonContainer.style.alignItems = 'center'; // 添加这行以确保所有元素垂直居中
    buttonContainer.style.width = '100%';
    buttonContainer.style.marginTop = '10px';

    const drawModeButton = createButton('矩形/自由绘制');
    drawModeButton.style.fontWeight = 'normal';
    updateDrawModeButton(drawModeButton);

    const buttons = [
        { text: '关闭', onClick: () => closePreviewWindow(previewWindow) },
        { text: '矩形/自由绘制', onClick: () => {
            drawMode = drawMode === 'rectangle' ? 'freeform' : 'rectangle';
            updateDrawModeButton(drawModeButton);
            updateStatus(`切换到${drawMode === 'rectangle' ? '矩形' : '自由绘制'}模式`);
        }},
        { text: '保存蒙版', onClick: saveMask },
        { text: '重置蒙版', onClick: resetMask },
        { text: '撤销', onClick: undoLastDraw }
    ];

    buttons.forEach(buttonInfo => {
        const button = buttonInfo.text === '矩形/自由绘制' ? drawModeButton : createButton(buttonInfo.text);
        button.style.padding = '10px';
        button.style.margin = '0 5px';
        button.style.backgroundColor = '#f0f0f0';
        button.style.border = 'none';
        button.style.borderRadius = '5px';
        button.style.cursor = 'pointer';
        button.onclick = buttonInfo.onClick;
        buttonContainer.appendChild(button);
    });

    // 创建重绘强度选择下拉框
    const strengthSelect = document.createElement('select');
    strengthSelect.id = 'denoisingStrengthSelect';
    strengthSelect.style.padding = '5px';
    strengthSelect.style.marginLeft = '10px';
    strengthSelect.style.borderRadius = '5px';
    strengthSelect.style.border = '1px solid #ccc';

    for (let i = 3; i <= 8; i++) {
        const option = document.createElement('option');
        const value = i / 10;
        option.value = value;
        option.textContent = value.toFixed(1);
        strengthSelect.appendChild(option);
    }

    // 设置默认值
    strengthSelect.value = '0.7'; // 设置默认重绘强度为 0.7

    // 创建标签
    const strengthLabel = document.createElement('label');
    strengthLabel.textContent = '重绘强度: ';
    strengthLabel.style.marginLeft = '10px';
    strengthLabel.appendChild(strengthSelect);

    // 将标签和选择框添加到按钮容器
    buttonContainer.appendChild(strengthLabel);

    contentContainer.appendChild(promptContainer);
    contentContainer.appendChild(canvas);
    contentContainer.appendChild(buttonContainer);

    previewWindow.appendChild(contentContainer);
    document.body.appendChild(previewWindow);

    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = getCanvasContext(canvas);
        ctx.drawImage(img, 0, 0);
        originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        originalImage = img;
        maskImage = document.createElement('canvas');
        maskImage.width = canvas.width;
        maskImage.height = canvas.height;
        resetMask();
    };
    img.src = src;

    // 添加扩展选择下拉框的事件监听器
    expandSelect.onchange = handleExpandSelectChange;

    // 添加画布事件监听器
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);

    // 添加触摸事件支持
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
    canvas.addEventListener('touchend', handleTouchEnd);
}

function createButton(text) {
    const button = document.createElement('button');
    button.textContent = text;
    return button;
}

function startDrawing(e) {
    isDrawing = true;
    const canvas = document.getElementById('editCanvas');
    const rect = canvas.getBoundingClientRect();
    
    // 计算画布的实际缩放比例
    const scaleY = canvas.height / rect.height;
    const scaleX = scaleY;

    startX = (e.clientX - rect.left) * scaleX;
    startY = (e.clientY - rect.top) * scaleY;

    const ctx = getCanvasContext(canvas);
    const maskCtx = getCanvasContext(maskImage);

    // 在开始新的绘制操作时，保存当前的 maskImage 状态
    drawHistory.push(maskCtx.getImageData(0, 0, maskImage.width, maskImage.height));

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
    const ctx = getCanvasContext(canvas);
    const rect = canvas.getBoundingClientRect();
    
    // 计算画布的实际缩放比例
    const scaleY = canvas.height / rect.height;
    const scaleX = scaleY;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const maskCtx = getCanvasContext(maskImage);

    requestAnimationFrame(() => {
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
    });
}

function stopDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;
    const canvas = document.getElementById('editCanvas');
    const ctx = getCanvasContext(canvas);
    const maskCtx = getCanvasContext(maskImage);
    const rect = canvas.getBoundingClientRect();
    
    // 计算画布的实际缩放比例
    const scaleY = canvas.height / rect.height;
    const scaleX = scaleY;

    if (drawMode === 'rectangle') {
        const endX = (e.clientX - rect.left) * scaleX;
        const endY = (e.clientY - rect.top) * scaleY;
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
    const maskCtx = getCanvasContext(maskImage);
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskImage.width, maskImage.height);
    const canvas = document.getElementById('editCanvas');
    const ctx = getCanvasContext(canvas);
    ctx.putImageData(originalImageData, 0, 0);

    // 清空绘制历史
    drawHistory = [];

    updateStatus('蒙版已重置');
}

async function sendMaskedImage(inpaintPrompt, expandSelect) {
    if (!expandSelect) {
        console.error('Expand select not provided');
        updateStatus("重绘失败：扩展选项未提供");
        return;
    }
    
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

    const expandValue = parseFloat(expandSelect.value);
    const expandedMaskImage = expandMask(maskImage, expandValue);
    const maskedImageData = expandedMaskImage.toDataURL('image/png');

    // console.log("***steps:", document.getElementById('sd-steps').value);

    const loraSelect = document.getElementById('sd-lora');
    const loraValue = loraSelect.value;
    const selectedOption = loraSelect.options[loraSelect.selectedIndex];
    const loraTriggerWords = selectedOption ? selectedOption.dataset.triggerWords : '';
    const loraWeight = parseFloat(document.getElementById('sd-lora-weight').value);
    
    const strengthSelect = document.getElementById('denoisingStrengthSelect');
    const denoisingStrength = parseFloat(strengthSelect.value);

    try {
        const response = await fetch(`${apiUrl}/sd/inpaint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                original_image: originalImageData,
                mask_image: maskedImageData,
                prompt: inpaintPrompt,
                steps: parseInt(document.getElementById('sd-steps').value),
                lora: loraValue !== "",
                lora_name: loraValue,
                lora_trigger_words: loraTriggerWords,
                lora_weight: loraWeight,
                denoising_strength: denoisingStrength, // 使用 denoising_strength
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        // console.log('Inpaint response:', result);  // 添加日志
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

    // 发送请求，更新状态但不关闭窗口（因为窗口已经在点击发送按钮时关闭）
    updateStatus("重绘请求已发送，请等待结果...");
}
async function pollTaskStatus(taskId) {
    const pollInterval = 2000; // 每2秒轮询一次

    while (true) {
        try {
            const response = await fetch(`${apiUrl}/sd/task_status/${taskId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.status === '重绘完成') {
                console.log('重绘任务完成，处理结果');
                processTaskResult(result);
                return;
            } else if (result.status === '重绘失败') {
                console.error('重绘任务失败:', result.error);
                updateStatus("重绘失败：" + (result.error || "未知错误"));
                return;
            } else if (result.status === '未知任务') {
                console.warn(`未知任务 ID: ${taskId}`);
                updateStatus("重绘失败：未知任务");
                return;
            }

            // 更新进度
            if (result.status === '排队中') {
                updateStatus(`排队中，当前位置：${result.queuePosition + 1}/${result.max_queue_size}`);
            } else {
                updateStatus(`重绘处理中：${result.status} (${result.progress}%)`);
            }

            // 等待一段时间后再次轮询
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        } catch (error) {
            console.error('轮询错误:', error);
            updateStatus("重绘失败：" + error.message);
            return;
        }
    }
}
function processTaskResult(result) {
    if (result.inpainted_image_url) {
        displayInpaintedImage(result.inpainted_image_url, result.inpaint_prompt);
        updateStatus("重绘完成", 5000);  // 示5秒
    } else {
        console.error('重绘结果中没有图片URL');
        updateStatus("重绘失败：未获取到结果图片", 5000);  // 显示5秒
    }
}

function displayInpaintedImage(imageUrl, inpaintPrompt) {
    console.log('开始执行 displayInpaintedImage 函数');
    console.log('imageUrl:', imageUrl);
    console.log('inpaintPrompt:', inpaintPrompt);

    const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${baseUrl}${imageUrl}`;
    console.log('fullImageUrl:', fullImageUrl);
    
    // 创建重绘结果容器
    let resultContainer = document.getElementById('inpaint-container');
    if (!resultContainer) {
        console.log('创建新的 resultContainer');
        resultContainer = document.createElement('div');
        resultContainer.id = 'inpaint-container';
        resultContainer.style.marginTop = '20px';
        resultContainer.style.border = '1px solid #ccc';
        resultContainer.style.padding = '10px';
        resultContainer.style.borderRadius = '5px';
        resultContainer.style.display = 'block';
        
        // 在原图容器下方插入结果容器
        const originalContainer = document.getElementById('sd-result-container');
        if (originalContainer) {
            console.log('将 resultContainer 插入到原始图片容器后');
            originalContainer.parentNode.insertBefore(resultContainer, originalContainer.nextSibling);
        } else {
            console.log('未找到原始图片容器，将 resultContainer 添加到 body');
            document.body.appendChild(resultContainer);
        }
    } else {
        console.log('使用现有的 resultContainer');
    }

    // 清空容器
    resultContainer.innerHTML = '';
    console.log('清空了 resultContainer');

    // 添加标题
    const title = document.createElement('h3');
    title.textContent = '重绘结果';
    resultContainer.appendChild(title);
    console.log('添加了标题');

    // 添加重绘prompt
    const promptPara = document.createElement('p');
    promptPara.textContent = `重绘Prompt: ${inpaintPrompt}`;
    resultContainer.appendChild(promptPara);
    console.log('添加了 prompt 段落');

    // 创建图片容器
    const imageContainer = document.createElement('div');
    imageContainer.style.textAlign = 'center';
    imageContainer.style.position = 'relative';
    resultContainer.appendChild(imageContainer);

    // 添加重绘图片
    const resultImage = document.createElement('img');
    resultImage.src = fullImageUrl;
    resultImage.style.maxWidth = '100%';
    resultImage.style.height = 'auto';
    resultImage.style.display = 'inline-block';
    resultImage.alt = '重绘结果图片';
    resultImage.onerror = function() {
        console.error('图片加载失败:', fullImageUrl);
        this.alt = '图加载失败';
    };
    resultImage.onload = function() {
        console.log('图片加载成功');
    };
    imageContainer.appendChild(resultImage);
    console.log('添加了结果图片');

    // 添加发送到上方的按钮
    const sendToTopButton = document.createElement('button');
    sendToTopButton.textContent = '发送到上方';
    sendToTopButton.style.position = 'absolute';
    sendToTopButton.style.top = '10px';
    sendToTopButton.style.right = '10px';
    sendToTopButton.style.backgroundColor = '#4CAF50';
    sendToTopButton.style.color = 'white';
    sendToTopButton.style.border = 'none';
    sendToTopButton.style.borderRadius = '5px';
    sendToTopButton.style.padding = '10px';
    sendToTopButton.style.fontSize = '16px';
    sendToTopButton.style.cursor = 'pointer';
    sendToTopButton.style.zIndex = '10';  // 确保按钮在图片上方
    sendToTopButton.onclick = function() {
        sendImageToTop(fullImageUrl, inpaintPrompt);
    };
    imageContainer.appendChild(sendToTopButton);
    console.log('添加了发送到上方的按钮');

    // 显示容器
    resultContainer.style.display = 'block';
    console.log('设置 resultContainer 为显示状态');

    console.log('displayInpaintedImage 函数执行完毕');
}

function sendImageToTop(imageUrl, prompt) {
    console.log('开始执行 sendImageToTop 函数');
    console.log('imageUrl:', imageUrl);
    console.log('prompt:', prompt);

    // 查找原图容器
    const originalImageContainer = document.getElementById('sd-result-container');
    if (originalImageContainer) {
        console.log('找到原图容器');

        // 查找原图容器中的图片元素
        const originalImage = originalImageContainer.querySelector('img');
        if (originalImage) {
            console.log('找到原图元素');

            // 替换原图的 src
            originalImage.src = imageUrl;
            console.log('替换了原图的 src');

            // 更新相关的输入字段
            const promptInput = document.getElementById('sd-prompt');
            if (promptInput) {
                promptInput.value = prompt;
                console.log('更新了 prompt 输入字段');
            } else {
                console.log('未找到 prompt 输入字段');
            }

            // 滚动到页面顶部
            window.scrollTo(0, 0);
            console.log('滚动到页面顶部');

            // 显示一个提示消息
            updateStatus("图片已发送到上方，可以继续编辑", 3000);
        } else {
            console.error('未在原图容器中找到图片元素');
            updateStatus("操作失败：未找到原图元素", 3000);
        }
    } else {
        console.error('未找到原图容器');
        updateStatus("操作失败：未找到原图容器", 3000);
    }

    console.log('sendImageToTop 函数执行完毕');
}

function saveMask() {
    if (!maskImage) {
        console.error('Mask image is not initialized');
        return;
    }
    const expandValue = parseFloat(document.getElementById('expandSelect').value);
    const expandedMaskImage = expandMask(maskImage, expandValue);
    
    const link = document.createElement('a');
    link.download = 'mask.png';
    link.href = expandedMaskImage.toDataURL('image/png');
    link.click();
}

function showLoadingIndicator() {
    updateStatus("正在提交重绘任务...");
}

function hideLoadingIndicator() {
    // 不需要执行任何操作，因为状态更新会在其他函数中处理
}

function updateStatus(message, duration = 0) {
    const statusContainer = document.getElementById('sd-status-container');
    if (statusContainer) {
        statusContainer.textContent = message;
        if (duration > 0) {
            setTimeout(() => {
                statusContainer.textContent = '';
            }, duration);
        }
    } else {
        console.error('未找到 sd-status-container 元素');
    }
}

function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const canvas = document.getElementById('editCanvas');
    const rect = canvas.getBoundingClientRect();
    
    // 计算画布的实际缩放比例
    // const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaleX = scaleY;

    console.log("start scaleX:", scaleX);
    console.log("start scaleY:", scaleY);
    
    startX = (touch.clientX - rect.left) * scaleX;
    startY = (touch.clientY - rect.top) * scaleY;

    isDrawing = true;

    const ctx = getCanvasContext(canvas);
    const maskCtx = getCanvasContext(maskImage);

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
    const ctx = getCanvasContext(canvas);
    const rect = canvas.getBoundingClientRect();
    
    // 计算画布的实际缩放比例
    // const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaleX = scaleY;
    
    console.log("move scaleX:", scaleX);
    console.log("move scaleY:", scaleY);
    
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;

    const maskCtx = getCanvasContext(maskImage);

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
    const ctx = getCanvasContext(canvas);
    const maskCtx = getCanvasContext(maskImage);
    const rect = canvas.getBoundingClientRect();
    
    // 计算画布的实际缩放比例
    // const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaleX = scaleY;

    console.log("end scaleX:", scaleX);
    console.log("end scaleY:", scaleY);

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

// 新增扩展蒙版函数
function expandMask(originalMask, expandRatio) {
    if (expandRatio === 0 || !originalMask) return originalMask;

    const expandedCanvas = document.createElement('canvas');
    const expandedWidth = originalMask.width * (1 + 2 * expandRatio);
    expandedCanvas.width = expandedWidth;
    expandedCanvas.height = originalMask.height;

    const ctx = expandedCanvas.getContext('2d');
    
    // 填充白色背景
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, expandedCanvas.width, expandedCanvas.height);

    // 在中间绘制原始蒙版
    const offsetX = originalMask.width * expandRatio;
    ctx.drawImage(originalMask, offsetX, 0);

    return expandedCanvas;
}

// 新增函数：处理扩展选择变化
function handleExpandSelectChange(event) {
    const selectedValue = event.target.value;
    if (selectedValue !== '0') {
        showExpandWarning();
        disableDrawing();
    } else {
        enableDrawing();
    }
}

// 新增函数：显示扩图警告
function showExpandWarning() {
    const warningMessage = '扩图模式不支持MASK';
    updateStatus(warningMessage, 2000);
}

// 新增函数：禁用绘制功能
function disableDrawing() {
    const canvas = document.getElementById('editCanvas');
    if (canvas) {
        canvas.style.pointerEvents = 'none';
        canvas.style.opacity = '0.5';
    }
}

// 新增函数：启用绘制功能
function enableDrawing() {
    const canvas = document.getElementById('editCanvas');
    if (canvas) {
        canvas.style.pointerEvents = 'auto';
        canvas.style.opacity = '1';
    }
}

// 添加一个新的函数来处理关闭预览窗口
function closePreviewWindow(previewWindow) {
    if (previewWindow && previewWindow.parentNode) {
        previewWindow.parentNode.removeChild(previewWindow);
    }
}

function undoLastDraw() {
    if (drawHistory.length > 0) {
        const canvas = document.getElementById('editCanvas');
        const ctx = getCanvasContext(canvas);
        const maskCtx = getCanvasContext(maskImage);

        // 恢复上一步的 maskImage 状态
        const lastState = drawHistory.pop();
        maskCtx.putImageData(lastState, 0, 0);

        // 重新绘制 canvas
        ctx.putImageData(originalImageData, 0, 0);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(maskImage, 0, 0);
        ctx.globalAlpha = 1.0;

        updateStatus('已撤销上一步绘制');
    } else {
        updateStatus('没有可撤销的操作');
    }
}

function updateDrawModeButton(button) {
    if (drawMode === 'rectangle') {
        button.innerHTML = '<strong>矩形</strong>/自由绘制';
    } else {
        button.innerHTML = '矩形/<strong>自由绘制</strong>';
    }
}

