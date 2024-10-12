// Global variables
let selectedImage = null;
let maskImage = null;
let isDrawing = false;
let originalImageData = null;
let drawMode = 'rectangle';
let startX, startY;

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

    const buttonContainer = document.createElement('div');
    buttonContainer.style.marginTop = '20px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';

    const closeButton = createButton('关闭', () => document.body.removeChild(previewWindow));
    const toggleModeButton = createButton('切换绘制模式', toggleDrawMode);
    const resetButton = createButton('重置蒙版', resetMask);
    const sendButton = createButton('发送重绘', () => sendMaskedImage(taskId));  // 传递 taskId

    buttonContainer.appendChild(closeButton);
    buttonContainer.appendChild(toggleModeButton);
    buttonContainer.appendChild(resetButton);
    buttonContainer.appendChild(sendButton);

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
}

function draw(e) {
    if (!isDrawing) return;
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.putImageData(originalImageData, 0, 0);
    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'rectangle') {
        ctx.strokeStyle = 'white';
        ctx.strokeRect(startX, startY, x - startX, y - startY);
    } else {
        maskCtx.strokeStyle = 'white';
        maskCtx.lineWidth = 5;
        maskCtx.lineTo(x, y);
        maskCtx.stroke();
    }

    ctx.globalAlpha = 0.5;
    ctx.drawImage(maskImage, 0, 0);
    ctx.globalAlpha = 1.0;
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    const canvas = document.getElementById('editCanvas');
    const ctx = canvas.getContext('2d');
    const maskCtx = maskImage.getContext('2d');

    if (drawMode === 'rectangle') {
        const rect = canvas.getBoundingClientRect();
        const endX = event.clientX - rect.left;
        const endY = event.clientY - rect.top;
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(startX, startY, endX - startX, endY - startY);
    }

    maskCtx.beginPath();
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

async function sendMaskedImage(taskId) {
    const canvas = document.getElementById('editCanvas');
    const maskedImageData = canvas.toDataURL('image/png').split(',')[1];
    const promptInput = document.createElement('input');
    promptInput.type = 'text';
    promptInput.placeholder = '输入重绘 prompt';
    document.body.appendChild(promptInput);

    promptInput.addEventListener('keyup', async (event) => {
        if (event.key === 'Enter') {
            const inpaintPrompt = promptInput.value;
            document.body.removeChild(promptInput);

            try {
                const response = await fetch(`${apiUrl}/sd/inpaint`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskId: taskId,  // 使用传入的 taskId
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
    });
}

function displayInpaintedImage(result) {
    const inpaintedImg = document.createElement('img');
    inpaintedImg.src = `data:image/png;base64,${result.inpaintedImage}`;
    inpaintedImg.alt = '重绘后的图像';
    inpaintedImg.className = 'sd-image';
    
    const sdResultContainer = document.getElementById('sd-result-container');
    sdResultContainer.appendChild(inpaintedImg);
}

// 确保正确导出 openPreviewWindow 函数
// export { openPreviewWindow };
