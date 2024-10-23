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
    deleteButton.className = 'icon-button';
    deleteButton.style.position = 'fixed';
    deleteButton.style.top = '10px';
    deleteButton.style.right = '10px';
    deleteButton.innerHTML = `
        <svg width="23" height="23" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 7.5V19.5C5 20.0523 5.44772 20.5 6 20.5H17C17.5523 20.5 18 20.0523 18 19.5V7.5H5Z" stroke="currentColor" stroke-width="1.5"/>
            <path d="M8.5 10V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M11.5 10V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M14.5 10V18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M3.5 5H19.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M9 2.5H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    `;
    deleteButton.addEventListener('click', toggleDeleteMode);
    document.body.appendChild(deleteButton);

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .icon-button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 5px;
            color: #666;
            transition: color 0.3s ease;
        }
        .icon-button:hover {
            color: #000;
        }
        .icon-button:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
        }
    `;
    document.head.appendChild(style);
});
