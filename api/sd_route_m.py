<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stable Diffusion</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 10px;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 960px;
            margin: auto;
            background: white;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 15px;
        }
        .form-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
        }
        .form-group {
            display: flex;
            flex-direction: column;
        }
        .form-group label {
            margin-bottom: 5px;
        }
        .form-group.full {
            flex: 1;
        }
        .form-group.quarter {
            flex: 0 0 23%;
        }
        .input-row {
            display: flex;
            align-items: center;
        }
        .input-row label {
            width: 60px;
            margin-right: 10px;
        }
        input[type="text"], input[type="number"], select, textarea {
            width: 100%;
            padding: 6px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        textarea {
            min-height: 60px;
            resize: vertical;
        }
        .button-group {
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
        }
        button {
            flex: 1;
            padding: 8px;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
            background: #4a90e2;
        }
        button:hover {
            opacity: 0.9;
        }
        #statusResult {
            margin-top: 15px;
            padding: 8px;
            background: #e9e9e9;
            border-radius: 4px;
        }
        #taskContainer {
            margin-top: 15px;
        }
        .imageContainer {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-around;
            margin-top: 10px;
        }
        .imageContainer img {
            max-width: 48%;
            margin-bottom: 10px;
            border-radius: 4px;
            box-shadow: 0 0 5px rgba(0,0,0,0.2);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Stable Diffusion</h1>

        <div class="form-row">
            <div class="form-group full">
                <div class="input-row">
                    <label for="model">模型</label>
                    <select id="model">
                        <option value="flux1-dev-bnb-nf4-v2.safetensors">flux1-dev-bnb-nf4-v2.safetensors</option>
                        <option value="realisticVisionV51_v51VAE.safetensors">realisticVisionV51_v51VAE.safetensors</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group full">
                <div class="input-row">
                    <label for="prompt">提示词</label>
                    <textarea id="prompt" placeholder="输入提示词" rows="2"></textarea>
                </div>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group quarter">
                <label for="width">宽度</label>
                <select id="width" onchange="updateHeight()">
                    <option value="512">512</option>
                    <option value="800">800</option>
                    <option value="1024">1024</option>
                </select>
            </div>
            <div class="form-group quarter">
                <label for="ratio">比例</label>
                <select id="ratio" onchange="updateHeight()">
                    <option value="1:1">1:1</option>
                    <option value="4:3">4:3</option>
                    <option value="16:9">16:9</option>
                    <option value="3:4">3:4</option>
                    <option value="9:16">9:16</option>
                </select>
            </div>
            <div class="form-group quarter">
                <label for="numImages">数量</label>
                <select id="numImages">
                    <option value="1">1</option>
                    <option value="2">2</option>
                </select>
            </div>
            <div class="form-group quarter">
                <label for="seed">种子</label>
                <input type="number" id="seed" value="-1" min="-1">
            </div>
        </div>

        <div class="button-group">
            <button id="generateBtn" onclick="generateImages()">生成图片</button>
        </div>

        <div id="statusResult">状态：空闲</div>
        <div id="taskContainer"></div>
    </div>

    <script>
        const apiUrl = '';  // 替换为您的服务器地址
        let currentTaskId = null;
        let taskQueue = [];
        let statusCheckInterval = null;

        function updateHeight() {
            // 在这个版本中，我们不需要更新高度，因为宽度是固定选项
        }

        async function generateImages() {
            const generateBtn = document.getElementById('generateBtn');
            generateBtn.disabled = true;

            const width = parseInt(document.getElementById('width').value);
            const ratio = document.getElementById('ratio').value;
            const [w, h] = ratio.split(':').map(Number);
            const height = Math.round(width * h / w);

            const params = {
                model: document.getElementById('model').value,
                prompt: document.getElementById('prompt').value,
                negative_prompt: "NSFW",  // 默认负面提示词
                width: width,
                height: height,
                num_images: parseInt(document.getElementById('numImages').value),
                seed: parseInt(document.getElementById('seed').value),
            };

            try {
                const response = await fetch(`${apiUrl}/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                });

                if (response.status === 429) {
                    const errorData = await response.json();
                    updateStatus(errorData.error);
                    generateBtn.disabled = false;
                    return;
                }

                const data = await response.json();
                if (data.task_id) {
                    addToQueue(data.task_id);
                } else {
                    updateStatus("生成失败：未收到任务ID");
                }
            } catch (error) {
                console.error('Error:', error);
                updateStatus("生成失败：网络错误");
            } finally {
                generateBtn.disabled = false;
            }
        }

        function addToQueue(taskId) {
            taskQueue.push(taskId);
            createTaskStatusElement(taskId);
            updateStatus(`已加入队列`);
            if (!currentTaskId) {
                processNextTask();
            }
        }

        function processNextTask() {
            if (taskQueue.length > 0) {
                currentTaskId = taskQueue.shift();
                updateStatus(`处理中`);
                startStatusCheck();
            } else {
                currentTaskId = null;
                updateStatus("空闲");
            }
        }

        function createTaskStatusElement(taskId) {
            const taskContainer = document.getElementById('taskContainer');
            const taskElement = document.createElement('div');
            taskElement.id = `task-${taskId}`;
            taskElement.innerHTML = `
                <div class="imageContainer"></div>
            `;
            taskContainer.appendChild(taskElement);
        }

        function startStatusCheck() {
            clearInterval(statusCheckInterval);
            statusCheckInterval = setInterval(checkStatus, 1000);
        }

        async function checkStatus() {
            if (!currentTaskId) return;

            try {
                const response = await fetch(`${apiUrl}/status/${currentTaskId}`);
                const data = await response.json();

                updateStatus(`${data.status} - 进度：${data.progress}%`);

                if (data.status === "完成" || data.status.startsWith("失败")) {
                    clearInterval(statusCheckInterval);

                    if (data.status === "完成" && data.file_names) {
                        displayImages(currentTaskId, data.file_names);
                    }

                    processNextTask();
                }
            } catch (error) {
                console.error('Error:', error);
                updateStatus("状态查询失败");
                clearInterval(statusCheckInterval);
                processNextTask();
            }
        }

        function updateStatus(message) {
            document.getElementById('statusResult').textContent = `状态：${message}`;
        }

        function displayImages(taskId, fileNames) {
            const taskElement = document.getElementById(`task-${taskId}`);
            if (taskElement) {
                const imageContainer = taskElement.querySelector('.imageContainer');
                imageContainer.innerHTML = '';
                fileNames.forEach(fileName => {
                    const img = document.createElement('img');
                    img.src = `${apiUrl}/images/${taskId}/${fileName}`;
                    img.style.width = fileNames.length === 1 ? '100%' : '48%';
                    imageContainer.appendChild(img);
                });
            }
        }
    </script>
</body>
</html>