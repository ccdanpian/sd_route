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
            openPreviewWindow(imageUrl);
        } catch (error) {
            console.error('Error processing image:', error);
            alert('图片处理失败，请重试');
        }
    }
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
