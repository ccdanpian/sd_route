// upload.js

import { openPreviewWindow } from './inpaint.js';

export function initUploadButton() {
    const uploadBtn = document.getElementById('upload-local-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', triggerFileUpload);
    } else {
        console.error('上传按钮未找到');
    }
}

function triggerFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = handleFileSelect;
    input.click();
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        try {
            const compressedImage = await compressImageIfNeeded(file);
            const imageUrl = URL.createObjectURL(compressedImage);
            displayUploadedImage(imageUrl, file.name);
        } catch (error) {
            console.error('Error processing image:', error);
            alert('图片处理失败，请重试');
        }
    }
}

function displayUploadedImage(imageUrl, fileName) {
    const resultContainer = document.getElementById('sd-result-container');
    
    // Clear existing content
    resultContainer.innerHTML = '';
    
    // Create new elements
    const containerImagesSD = document.createElement('div');
    containerImagesSD.className = 'container_images_sd';
    containerImagesSD.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;';
    
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    imageWrapper.style.cssText = 'display: flex; flex-direction: column; align-items: center; position: relative;';
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = '上传的图像';
    img.className = 'sd-image';
    img.style.cssText = 'max-width: 100%; height: auto;';
    img.addEventListener('click', () => openPreviewWindow(imageUrl));
    
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'display: flex; justify-content: space-between; width: 100%; margin-top: 5px;';
    infoDiv.innerHTML = `<div>文件名：${fileName}</div>`;
    
    // Assemble the elements
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(infoDiv);
    containerImagesSD.appendChild(imageWrapper);
    resultContainer.appendChild(containerImagesSD);
}

async function compressImageIfNeeded(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function() {
            URL.revokeObjectURL(img.src);
            if (img.width > 1024 || img.height > 1024) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const scale = Math.min(1024 / img.width, 1024 / img.height);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(resolve, 'image/jpeg', 0.9);
            } else {
                resolve(file);
            }
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}
