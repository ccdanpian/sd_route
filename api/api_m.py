from flask import Flask, request, jsonify, send_from_directory
import requests
import io
import base64
from PIL import Image
import os
import random
from datetime import datetime
import threading
import time
import json
import numpy as np
import logging
import urllib3
from uuid import uuid4
from collections import deque

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 从环境变量获取配置
SD_URL = os.getenv('SD_URL', 'https://sd.italkwithai.online:21443')
output_dir = os.getenv('SD_OUTPUT_DIR', 'output')

logger.info(f"SD_URL: {SD_URL}")
logger.info(f"Output directory: {output_dir}")

# 任务队列和状态字典
task_queue = deque()
task_status = {}
task_lock = threading.Lock()
MAX_CONCURRENT_TASKS = 3
current_tasks = 0

def worker():
    global current_tasks
    while True:
        if task_queue and current_tasks < MAX_CONCURRENT_TASKS:
            with task_lock:
                task = task_queue.popleft()
                current_tasks += 1
            process_task(task)
            with task_lock:
                current_tasks -= 1
        else:
            time.sleep(1)

# 启动工作线程
worker_thread = threading.Thread(target=worker, daemon=True)
worker_thread.start()

def process_task(task):
    task_id = task['task_id']
    update_task_status(task_id, "处理中", 0)
    try:
        seeds, file_names = generate_images(**task)
        update_task_status(task_id, "完成", 100, seeds=seeds, file_names=file_names)
    except Exception as e:
        update_task_status(task_id, f"失败: {str(e)}", 100)

def update_task_status(task_id, status, progress, seeds=None, file_names=None):
    with task_lock:
        task_status[task_id] = {
            "status": status,
            "progress": progress,
            "seeds": seeds,
            "file_names": file_names
        }
    logger.info(f"任务 {task_id} 状态更新: {status}, 进度: {progress}%")

@app.route('/')
def index():
    logger.info("访问主页")
    return send_from_directory('static', 'index.html')

def generate_images(task_id, model, prompt, negative_prompt, width, height, num_images, seed):
    if seed == -1:
        seed = random.randint(0, 2**32 - 1)

    payload = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "steps": 30,
        "sampler_name": "Euler",
        "scheduler": "Simple",
        "cfg_scale": 1,
        "width": width,
        "height": height,
        "seed": seed,
        "batch_size": num_images,
        "model": model,
    }

    logger.debug(f"Payload: {json.dumps(payload, indent=2)}")

    update_task_status(task_id, f"正在使用模型 {model} 生成图片...", 0)
    try:
        logger.info(f"发送请求到 {SD_URL}/sdapi/v1/txt2img")
        response = requests.post(url=f'{SD_URL}/sdapi/v1/txt2img', json=payload, verify=False, timeout=120)
        response.raise_for_status()
        logger.debug(f"Response status code: {response.status_code}")
    except requests.exceptions.RequestException as e:
        logger.error(f"生成图片请求失败: {str(e)}")
        raise Exception(f"生成图片请求失败: {str(e)}")

    try:
        r = response.json()
    except json.JSONDecodeError:
        logger.error("无法解析JSON响应")
        raise Exception("无法解析JSON响应")

    if 'images' not in r:
        logger.error("响应中没有 'images' 键")
        raise Exception("响应中没有 'images' 键")

    # 处理 'info' 字段
    info = r.get('info', '{}')
    if isinstance(info, str):
        try:
            info = json.loads(info)
        except json.JSONDecodeError:
            logger.error("无法解析 'info' 字符串为 JSON")
            info = {}

    seeds = info.get('all_seeds', [seed] * num_images)
    images = r['images']
    logger.info(f"生成的图片数量: {len(images)}")  

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    task_output_dir = os.path.join(output_dir, task_id)
    os.makedirs(task_output_dir, exist_ok=True)

    saved_files = []
    for i, img_data in enumerate(images):
        progress = int((i + 1) / num_images * 100)
        update_task_status(task_id, f"处理图片 {i+1}/{num_images}", progress)

        if not isinstance(img_data, str) or not img_data.strip():
            logger.warning(f"图片 {i+1} 的数据无效")
            continue

        try:
            image_data = base64.b64decode(img_data)
            image = Image.open(io.BytesIO(image_data))
            file_name = f"{timestamp}_{model}_{seeds[i]}.png"
            file_path = os.path.join(task_output_dir, file_name)
            image.save(file_path)
            saved_files.append(file_name)

            logger.info(f"图片 {i+1} 已保存")

        except Exception as e:
            logger.error(f"处理图片 {i+1} 时出错: {str(e)}")

    update_task_status(task_id, "所有图片生成完成", 100)
    return seeds, saved_files

@app.route('/generate', methods=['POST'])
def generate():
    logger.info("收到生成图片请求")
    data = request.json
    logger.debug(f"请求数据: {json.dumps(data, indent=2)}")

    task_id = str(uuid4())
    task = {
        'task_id': task_id,
        'model': data.get('model', 'v1-5-pruned-emaonly.safetensors'),
        'prompt': data.get('prompt', ''),
        'negative_prompt': data.get('negative_prompt', ''),
        'width': data.get('width', 512),
        'height': data.get('height', 512),
        'num_images': data.get('num_images', 1),
        'seed': data.get('seed', -1)
    }

    with task_lock:
        if len(task_queue) + current_tasks >= MAX_CONCURRENT_TASKS:
            return jsonify({"error": "当前用户数量已达到上限，请稍后再试"}), 429
        task_queue.append(task)
        task_status[task_id] = {"status": "排队中", "progress": 0}

    return jsonify({"task_id": task_id})

@app.route('/status/<task_id>', methods=['GET'])
def get_status(task_id):
    logger.info(f"收到任务 {task_id} 的状态请求")
    with task_lock:
        status = task_status.get(task_id, {"status": "未知任务", "progress": 0})
    logger.debug(f"任务 {task_id} 状态: {status}")
    return jsonify(status)

@app.route('/images/<task_id>/<path:filename>')
def serve_image(task_id, filename):
    logger.info(f"请求图片: {task_id}/{filename}")
    return send_from_directory(os.path.join(output_dir, task_id), filename)

if __name__ == '__main__':
    logger.info("启动服务器")
    app.run(host='0.0.0.0', port=25000, threaded=True)