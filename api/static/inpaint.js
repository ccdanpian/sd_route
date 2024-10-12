// Global variables
let selectedImage = null;
let maskImage = null;
let isDrawing = false;
let originalImageData = null;
let drawMode = 'rectangle';
let startX, startY;

const apiUrl = window.location.origin;

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

    const sendButton = createButton('发送���绘', () => sendMaskedImage(taskId, promptInput.value));

    promptContainer.appendChild(promptInput);
    promptContainer.appendChild(sendButton);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '20px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';

    const closeButton = createButton('关闭', () => document.body.removeChild(previewWindow));
    const toggleModeButton = createButton('切换绘制模式', toggleDrawMode);
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
        maskImage = document.createElement('canvas');
        maskImage.width = canvas.width;
        maskImage.height = canvas.height;
        resetMask();
    };
    img.src = src;

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
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
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

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
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

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
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
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

function toggleDrawMode() {
    drawMode = drawMode === 'rectangle' ? 'freeform' : 'rectangle';
    const toggleModeButton = document.querySelector('button:nth-child(2)');
    toggleModeButton.textContent = drawMode === 'rectangle' ? '切换到自由绘制' : '切换到矩形绘制';
}

function resetMask() {
    const maskCtx = maskImage.getContext('2d');
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskImage.width, maskImage.height);
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    ctx.putImageData(originalImageData, 0, 0);
}

async function sendMaskedImage(taskId, inpaintPrompt) {
    const canvas = document.getElementById('editCanvas');
    const maskedImageData = canvas.toDataURL('image/png').split(',')[1];
    
    try {
        const response = await fetch(`${apiUrl}/sd/inpaint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskId: taskId,
                maskedImage: maskedImageData,
                prompt: inpaintPrompt
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        displayInpaintedImage(result);
    } catch (error) {
        console.error('Error:', error);
        updateStatus("重绘失败：" + error.message);
    }
}

function displayInpaintedImage(result) {
    const inpaintedImg = document.createElement('img');
    inpaintedImg.src = `data:image/png;base64,${result.inpaintedImage}`;
    inpaintedImg.alt = '重绘后的图像';
    inpaintedImg.className = 'sd-image';
    
    const sdResultContainer = document.getElementById('sd-result-container');
    sdResultContainer.appendChild(inpaintedImg);
}

function saveMask() {
    const link = document.createElement('a');
    link.download = 'mask.png';
    link.href = maskImage.toDataURL('image/png');
    link.click();
}

// 确保正确导出 openPreviewWindow 函数
// export { openPreviewWindow };
