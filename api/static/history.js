import { apiRequest } from './api.js';

export function openHistoryTab() {
    window.open('./static/history.html', '_blank');
}

let currentPage = 1;
let totalPages = 1;
const perPage = 10;

export async function searchImages(loadMore = false) {
    const resultsContainer = document.getElementById('results');
    const paginationContainer = document.getElementById('pagination');

    if (!loadMore) {
        // 清除之前的搜索结果和分页信息
        currentPage = 1;
        resultsContainer.innerHTML = '';
        paginationContainer.innerHTML = '';
    }

    const keyword = document.getElementById('keyword').value;
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    
    try {
        const data = await apiRequest('/sd/query_images', 'POST', { 
            keyword, 
            start_date: startDate, 
            end_date: endDate,
            page: currentPage,
            per_page: perPage
        });
        
        displayResults(data.images);
        updatePagination(data);
    } catch (error) {
        console.error('Error fetching images:', error);
        alert('查询图像时出错，请稍后再试。');
    }
}

function displayResults(images) {
    const resultsContainer = document.getElementById('results');
    
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

function updatePagination(data) {
    totalPages = data.total_pages;
    const paginationContainer = document.getElementById('pagination');
    paginationContainer.innerHTML = '';

    const paginationInfo = document.createElement('div');
    paginationInfo.className = 'pagination-info';
    paginationInfo.textContent = `第 ${currentPage} 页，共 ${totalPages} 页`;
    paginationContainer.appendChild(paginationInfo);

    if (currentPage < totalPages) {
        const loadMoreButton = document.createElement('button');
        loadMoreButton.className = 'load-more-button';
        loadMoreButton.textContent = '加载更多';
        loadMoreButton.onclick = () => {
            currentPage++;
            searchImages(true);
        };
        paginationContainer.appendChild(loadMoreButton);
    }
}

// 修改事件监听器
document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    searchButton.addEventListener('click', () => searchImages(false));
});
