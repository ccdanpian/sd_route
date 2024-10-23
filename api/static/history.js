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
        card.innerHTML = `
            <div class="image-wrapper">
                <img src="data:image/jpeg;base64,${image.base64}" alt="Generated Image">
                <button class="delete-icon" style="display: none;">X</button>
            </div>
            <div class="image-info">
                <p><strong>时间：</strong>${new Date(image.created_at).toLocaleString()}</p>
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
    const deleteIcons = document.querySelectorAll('.delete-icon');
    deleteIcons.forEach(icon => {
        icon.style.display = isDeleteMode ? 'block' : 'none';
    });
    
    const deleteButton = document.getElementById('deleteButton');
    deleteButton.textContent = isDeleteMode ? '取消删除' : '删除图片';
}

async function deleteImage(imageId) {
    if (confirm('确定要删除这张图片吗？')) {
        try {
            await apiRequest('/sd/delete_image', 'POST', { image_id: imageId });
            alert('图片已成功删除');
            // 重新加载图片列表
            searchImages(false);
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

    // 添加删除按钮
    const deleteButton = document.createElement('button');
    deleteButton.id = 'deleteButton';
    deleteButton.textContent = '删除图片';
    deleteButton.style.position = 'fixed';
    deleteButton.style.top = '10px';
    deleteButton.style.right = '10px';
    deleteButton.addEventListener('click', toggleDeleteMode);
    document.body.appendChild(deleteButton);
});
