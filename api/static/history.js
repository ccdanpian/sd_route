import { apiRequest } from './api.js';

let currentPage = 1;
let totalPages = 1;
const perPage = 10;
let isDeleteMode = false;

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
    resultsContainer.innerHTML = ''; // Clear previous results
    
    images.forEach(image => {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.setAttribute('data-image-id', image.id); // 添加这一行
        card.innerHTML = `
            <div class="image-wrapper">
                <img src="data:image/jpeg;base64,${image.base64}" alt="Generated Image">
                <button class="delete-icon" style="display: ${isDeleteMode ? 'block' : 'none'};">X</button>
            </div>
            <div class="image-info">
                <p><strong>时间：</strong>${new Date(image.created_at + 'Z').toLocaleString()}</p>
                <p class="prompt"><strong>Prompt：</strong><span class="prompt-text">${image.prompt}</span></p>
                <p><strong>种子：</strong>${image.seed}</p>
                <p><strong>Model：</strong>${image.model}</p>
                <p><strong>LoRA：</strong>${image.lora || 'None'}</p>
            </div>
        `;
        resultsContainer.appendChild(card);

        const deleteIcon = card.querySelector('.delete-icon');
        deleteIcon.addEventListener('click', () => deleteImage(image.id));

        // 添加长按/长触摸事件处理
        const promptText = card.querySelector('.prompt-text');
        let longPressTimer;

        const startLongPress = () => {
            longPressTimer = setTimeout(() => {
                selectText(promptText);
            }, 500); // 500毫秒后触发长按事件
        };

        const endLongPress = () => {
            clearTimeout(longPressTimer);
        };

        promptText.addEventListener('mousedown', startLongPress);
        promptText.addEventListener('mouseup', endLongPress);
        promptText.addEventListener('mouseleave', endLongPress);
        promptText.addEventListener('touchstart', startLongPress);
        promptText.addEventListener('touchend', endLongPress);
    });
}

function selectText(element) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
}

function toggleDeleteMode() {
    isDeleteMode = !isDeleteMode;
    const deleteButton = document.getElementById('deleteButton');
    const deleteIcons = document.querySelectorAll('.delete-icon');
    
    if (isDeleteMode) {
        deleteButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        `;
        deleteButton.setAttribute('aria-label', '退出删除模式');
        deleteIcons.forEach(icon => icon.style.display = 'block');
    } else {
        deleteButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        deleteButton.setAttribute('aria-label', '删除模式');
        deleteIcons.forEach(icon => icon.style.display = 'none');
    }

    // 在这里添加其他删除模式相关的逻辑
    // 例如：显示或隐藏删除图标，更改鼠标样式等
}

async function deleteImage(imageId) {
    if (confirm('确定要删除这张图片吗？')) {
        try {
            await apiRequest('/sd/delete_image', 'POST', { image_id: imageId });
            // 找到并删除对应的图片卡片
            const card = document.querySelector(`.image-card[data-image-id="${imageId}"]`);
            if (card) {
                card.remove();
            }
            alert('图片已成功删除');
        } catch (error) {
            console.error('删除图片时出错:', error);
            alert('删除图片时出错，请稍后再试。');
        }
    }
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

    const deleteButton = document.getElementById('deleteButton');
    deleteButton.addEventListener('click', toggleDeleteMode);
});
