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
import logging
import urllib3
from uuid import uuid4
from queue import Queue, Full
from openai import OpenAI
from dotenv import load_dotenv

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 从环境变量获取配置
load_dotenv()
SD_URL = os.getenv('SD_URL', 'https://127.0.0.1:7861')
output_dir = os.getenv('SD_OUTPUT_DIR', 'output')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_API_BASE = os.getenv('OPENAI_API_BASE')

if not OPENAI_API_KEY:
    raise ValueError("请设置 OPENAI_API_KEY 环境变量")

# 创建 OpenAI 客户端
client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_API_BASE if OPENAI_API_BASE else "https://api.openai.com/v1"
)

logger.info(f"SD_URL: {SD_URL}")
logger.info(f"Output directory: {output_dir}")
logger.info(f"OpenAI API Base: {OPENAI_API_BASE if OPENAI_API_BASE else 'Using default'}")

# 任务队列和状态字典
MAX_QUEUE_SIZE = 3
task_queue = Queue(maxsize=MAX_QUEUE_SIZE)
task_status = {}
current_task = None
task_lock = threading.Lock()

def worker():
    global current_task
    while True:
        if not task_queue.empty() and current_task is None:
            with task_lock:
                current_task = task_queue.get()
            process_task(current_task)
            with task_lock:
                current_task = None
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
        update_task_status(task_id, "完成", 100, seeds=seeds, file_names=file_names, translated_prompt=task['prompt'])
    except Exception as e:
        logger.error(f"处理任务 {task_id} 时出错: {str(e)}")
        update_task_status(task_id, f"失败: {str(e)}", 100)

def update_task_status(task_id, status, progress, seeds=None, file_names=None, translated_prompt=None):
    with task_lock:
        task_status[task_id] = {
            "status": status,
            "progress": progress,
            "seeds": seeds,
            "file_names": file_names,
            "translated_prompt": translated_prompt
        }
    logger.info(f"任务 {task_id} 状态更新: {status}, 进度: {progress}%")

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

def check_prompt_with_chatgpt(prompt):
    try:
        logger.info(f"正在检查提示词: {prompt}")
        response = client.chat.completions.create(
            model="gpt-4o-mini-2024-07-18",
            messages=[
                {"role": "system", "content": "你是一个内容审核助手。请判断以下提示词是否包含严重色情或中国国家领导人信息。只回答'是'或'否'，不要解释。"},
                {"role": "user", "content": f"提示词: {prompt}"}
            ]
        )
        logger.debug(f"ChatGPT API 原始响应: {response}")
        
        if not response.choices:
            logger.error("ChatGPT API 响应中没有选项")
            return False

        result = response.choices[0].message.content.strip().lower()
        logger.info(f"ChatGPT 审核结果: {result}")
        return result == '是'
    except Exception as e:
        logger.error(f"ChatGPT API调用错误: {str(e)}")
        logger.exception("详细错误信息:")
        return False  # 如果API调用失败，我们假设内容是安全的

def translate_to_english(prompt):
    try:
        logger.info(f"正在将提示词翻译为英语: {prompt}")
        response = client.chat.completions.create(
            model="gpt-4o-mini-2024-07-18",
            messages=[
                {"role": "system", "content": "你是一个翻译助手。请将给定的文本翻译成英语。如果文本已经是英语，请原样返回。只返回翻译结果，不要添加任何解释、引号或额外的文字。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        if not response.choices:
            logger.error("ChatGPT API 响应中没有选项")
            return prompt

        translated_prompt = response.choices[0].message.content.strip()
        logger.info(f"翻译结果: {translated_prompt}")
        return translated_prompt
    except Exception as e:
        logger.error(f"ChatGPT API调用错误: {str(e)}")
        logger.exception("详细错误信息:")
        return prompt  # 如果API调用失败，返回原始prompt

@app.route('/')
def index():
    return send_from_directory('static', 'index_m.html')

@app.route('/generate', methods=['POST'])
def generate():
    logger.info("收到生成图片请求")
    data = request.json
    logger.debug(f"请求数据: {json.dumps(data, indent=2)}")

    prompt = data.get('prompt', '')
    if not prompt:
        return jsonify({"error": "提示词不能为空"}), 400

    # 使用ChatGPT检查提示词
    contains_inappropriate_content = check_prompt_with_chatgpt(prompt)

    if contains_inappropriate_content:
        return jsonify({"error": "提示词可能包含不适当的内容。请修改后重试。"}), 400

    # 翻译提示词为英语
    translated_prompt = translate_to_english(prompt)

    task_id = str(uuid4())
    task = {
        'task_id': task_id,
        'model': data.get('model', 'v1-5-pruned-emaonly.safetensors'),
        'prompt': translated_prompt,  # 使用翻译后的提示词
        'negative_prompt': data.get('negative_prompt', ''),
        'width': data.get('width', 512),
        'height': data.get('height', 512),
        'num_images': data.get('num_images', 1),
        'seed': data.get('seed', -1)
    }

    try:
        task_queue.put_nowait(task)
        task_status[task_id] = {"status": "排队中", "progress": 0}
        return jsonify({"task_id": task_id})
    except Full:
        return jsonify({"error": "队列已满，请稍后再试"}), 429

@app.route('/status/<task_id>', methods=['GET'])
def get_status(task_id):
    logger.info(f"收到任务 {task_id} 的状态请求")
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