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

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 从环境变量获取配置
SD_URL = os.getenv('SD_URL', 'https://sd.italkwithai.online:21443/')
output_dir = os.getenv('SD_OUTPUT_DIR', 'output')

logger.info(f"SD_URL: {SD_URL}")
logger.info(f"Output directory: {output_dir}")

# 全局变量来存储当前状态
current_status = "空闲"
status_lock = threading.Lock()

@app.route('/')
def index():
    logger.info("访问主页")
    return send_from_directory('static', 'index.html')

def update_status(message):
    global current_status
    with status_lock:
        current_status = message
    logger.info(f"状态更新: {message}")

def generate_images(model, prompt, negative_prompt, width, height, num_images, seed):
    if seed == -1:
        seed = random.randint(0, 2**32 - 1)
    
    payload = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "steps": 30,
        "sampler_name": "Euler",
        "cfg_scale": 1,
        "width": width,
        "height": height,
        "seed": seed,
        "batch_size": num_images,
        "model": model,
    }

    logger.debug(f"Payload: {json.dumps(payload, indent=2)}")
    
    update_status(f"正在使用模型 {model} 生成图片...")
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
        logger.debug(f"Response JSON keys: {r.keys()}")
    except json.JSONDecodeError:
        logger.error("无法解析JSON响应")
        raise Exception("无法解析JSON响应")

    if 'images' not in r:
        logger.error("响应中没有 'images' 键")
        raise Exception("响应中没有 'images' 键")

    seeds = r.get('info', {}).get('all_seeds', [seed] * num_images)
    images = r['images']
    logger.info(f"生成的图片数量: {len(images)}")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(output_dir, exist_ok=True)
    
    saved_files = []
    for i, img_data in enumerate(images):
        update_status(f"处理图片 {i+1}/{num_images}")
        
        if not isinstance(img_data, str) or not img_data.strip():
            logger.warning(f"图片 {i+1} 的数据无效")
            continue

        try:
            image_data = base64.b64decode(img_data)
            image = Image.open(io.BytesIO(image_data))
            file_name = f"{timestamp}_{model}_{seeds[i]}.png"
            file_path = os.path.join(output_dir, file_name)
            image.save(file_path)
            saved_files.append(file_name)

            logger.info(f"图片 {i+1} 信息 - 大小: {image.size}, 模式: {image.mode}")

            if image.mode == "RGB":
                img_array = np.array(image)
                logger.debug(f"图片 {i+1} 统计 - 形状: {img_array.shape}, 最小值: {img_array.min()}, 最大值: {img_array.max()}, 平均值: {img_array.mean():.2f}")

            logger.info(f"已保存图片 {i+1}/{num_images}")
            logger.debug(f"文件大小: {os.path.getsize(file_path)} bytes")

        except Exception as e:
            logger.error(f"处理图片 {i+1} 时出错: {str(e)}")
    
    update_status("所有图片生成完成")
    return seeds, saved_files

@app.route('/generate', methods=['POST'])
def generate():
    logger.info("收到生成图片请求")
    data = request.json
    logger.debug(f"请求数据: {json.dumps(data, indent=2)}")
    
    model = data.get('model', 'v1-5-pruned-emaonly.safetensors')
    prompt = data.get('prompt', '')
    negative_prompt = data.get('negative_prompt', '')
    width = data.get('width', 512)
    height = data.get('height', 512)
    num_images = data.get('num_images', 1)
    seed = data.get('seed', -1)

    try:
        seeds, file_names = generate_images(model, prompt, negative_prompt, width, height, num_images, seed)
        
        image_urls = [f"/images/{file_name}" for file_name in file_names]
        
        response = {
            "success": True,
            "seeds": seeds,
            "image_urls": image_urls
        }
        logger.info("图片生成成功")
        logger.debug(f"响应数据: {json.dumps(response, indent=2)}")
        return jsonify(response)
    except Exception as e:
        logger.error(f"图片生成失败: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/status', methods=['GET'])
def get_status():
    logger.info("收到状态请求")
    global current_status
    with status_lock:
        logger.debug(f"当前状态: {current_status}")
        return jsonify({"status": current_status})

@app.route('/images/<path:filename>')
def serve_image(filename):
    logger.info(f"请求图片: {filename}")
    return send_from_directory(output_dir, filename)

if __name__ == '__main__':
    logger.info("启动服务器")
    app.run(host='0.0.0.0', port=25000, threaded=True)
