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

app = Flask(__name__)

# 从环境变量获取配置
SD_URL = os.getenv('SD_URL', 'https://sd.italkwithai.online:21443/')
output_dir = os.getenv('SD_OUTPUT_DIR', 'output')

# 全局变量来存储当前状态
current_status = "空闲"
status_lock = threading.Lock()

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

def update_status(message):
    global current_status
    with status_lock:
        current_status = message
    print(f"状态更新: {message}")

def switch_model(model_name):
    update_status(f"正在切换到模型: {model_name}")
    response = requests.post(url=f'{SD_URL}/sdapi/v1/options', json={"sd_model_checkpoint": model_name})
    if response.status_code != 200:
        update_status(f"切换模型失败，状态码：{response.status_code}")
        raise Exception(f"切换模型失败，状态码：{response.status_code}")
    update_status(f"已成功切换到模型: {model_name}")

def generate_images(model, prompt, negative_prompt, width, height, num_images, seed):
    if seed == -1:
        seed = random.randint(0, 2**32 - 1)
    
    payload = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "steps": 30,
        "sampler_index": "Euler",
        "cfg_scale": 1,
        "width": width,
        "height": height,
        "seed": seed,
        "batch_size": num_images
    }

    update_status("正在生成图片...")
    response = requests.post(url=f'{SD_URL}/sdapi/v1/txt2img', json=payload)

    if response.status_code != 200:
        update_status(f"生成图片请求失败，状态码：{response.status_code}")
        raise Exception(f"生成图片请求失败，状态码：{response.status_code}")

    r = response.json()
    seeds = r.get('info', {}).get('all_seeds', [seed] * num_images)
    images = r['images']
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(output_dir, exist_ok=True)
    
    saved_files = []
    for i, img_data in enumerate(images):
        image = Image.open(io.BytesIO(base64.b64decode(img_data)))
        file_name = f"{timestamp}_{seeds[i]}.png"
        file_path = os.path.join(output_dir, file_name)
        image.save(file_path)
        saved_files.append(file_name)
        update_status(f"已保存图片 {i+1}/{num_images}")
    
    update_status("所有图片生成完成")
    return seeds, saved_files

@app.route('/switch_model', methods=['POST'])
def switch_model_route():
    data = request.json
    model = data.get('model')
    if not model:
        return jsonify({"success": False, "error": "No model specified"}), 400

    try:
        switch_model(model)
        return jsonify({"success": True, "message": f"Successfully switched to model: {model}"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
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
        
        return jsonify({
            "success": True,
            "seeds": seeds,
            "image_urls": image_urls
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/status', methods=['GET'])
def get_status():
    global current_status
    with status_lock:
        return jsonify({"status": current_status})

@app.route('/images/<path:filename>')
def serve_image(filename):
    return send_from_directory(output_dir, filename)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=25000, threaded=True)
