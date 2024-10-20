import { apiRequest } from './api.js';

export function openHistoryTab() {
    window.open('./static/history.html', '_blank');
}

export async function searchImages() {
    const keyword = document.getElementById('keyword').value;
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    
    try {
        const data = await apiRequest('/sd/query_images', 'POST', { keyword, start_date: startDate, end_date: endDate });
        displayResults(data);
    } catch (error) {
        console.error('Error fetching images:', error);
        alert('查询图像时出错，请稍后再试。');
    }
}

function displayResults(images) {
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = '';
    
    images.forEach(image => {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.innerHTML = `
            <img src="data:image/jpeg;base64,${image.base64}" alt="Generated Image">
            <div class="image-info">
                <p><strong>时间：</strong>${new Date(image.created_at).toLocaleString()}</p>
                <p class="prompt"><strong>Prompt：</strong>${image.prompt}</p>
                <p><strong>Model：</strong>${image.model}</p>
                <p><strong>LoRA：</strong>${image.lora || 'None'}</p>
            </div>
        `;
        resultsContainer.appendChild(card);
    });
}
