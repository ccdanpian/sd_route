from flask import Flask, request, jsonify, send_from_directory, make_response
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
from queue import Queue
from openai import OpenAI
from dotenv import load_dotenv
# from sqljs import insert_topic, insert_single_dialogue  # 假设这些函数已经在别处定义

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 从环境变量获取配置
load_dotenv()
SD_URL = os.getenv('SD_URL', 'https://127.0.0.1:7860')
OUTPUT_DIR = os.getenv('SD_OUTPUT_DIR', 'output')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_API_BASE = os.getenv('OPENAI_API_BASE')
ENABLE_IP_RESTRICTION = os.getenv('ENABLE_IP_RESTRICTION', 'False').lower() == 'true'
CHATGPT_MODEL = os.getenv('CHATGPT_MODEL', 'gpt-4o-mini-2024-07-18')
CONTENT_REVIEW_PROMPT = os.getenv('CONTENT_REVIEW_PROMPT', '你是一个内容审核助手。请判断以下提示词是否包含身体敏感部位未被遮挡、或中国国家领导人信息。只回答“是”或“否”，不要解释。')
# 新增环境变量引入
MAX_QUEUE_SIZE = int(os.getenv('MAX_QUEUE_SIZE', '3'))
SD_MODEL = os.getenv('SD_MODEL', 'v1-5-pruned-emaonly.safetensors')  # 从.env文件中获取大模型名称

if not OPENAI_API_KEY:
    raise ValueError("请设置 OPENAI_API_KEY 环境变量")

# 创建 OpenAI 客户端
client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_API_BASE if OPENAI_API_BASE else "https://api.openai.com/v1"
)

logger.info(f"SD_URL: {SD_URL}")
logger.info(f"Output directory: {OUTPUT_DIR}")
logger.info(f"OpenAI API Base: {OPENAI_API_BASE if OPENAI_API_BASE else 'Using default'}")
logger.info(f"IP restriction enabled: {ENABLE_IP_RESTRICTION}")
logger.info(f"ChatGPT Model: {CHATGPT_MODEL}")
logger.info(f"Max Queue Size: {MAX_QUEUE_SIZE}")  # 新增日志输出

# 任务队列和状态字典
task_queue = Queue(maxsize=MAX_QUEUE_SIZE)
task_status = {}
current_task = None
task_lock = threading.Lock()

# 添加一个字典来跟踪 IP 地址的活跃请求
active_ip_requests = {}
ip_lock = threading.Lock()

def update_queue_positions():
    with task_lock:
        for i, task in enumerate(list(task_queue.queue)):
            task_id = task['task_id']
            if task_id in task_status and task_status[task_id]['status'] == "排队中":
                task_status[task_id]['queuePosition'] = i

def process_task(task, phone_number, ip_address):
    global current_task
    task_id = task['task_id']
    update_task_status(task_id, "处理中", 0)
    try:
        seeds, file_names, save_time = generate_images(task)
        update_task_status(task_id, "完成", 100, seeds=seeds, file_names=file_names, translated_prompt=task['prompt'], phone_number=phone_number, save_time=save_time)
    except Exception as e:
        logger.error(f"处理任务 {task_id} 时出错: {str(e)}")
        update_task_status(task_id, f"失败: {str(e)}", 100, phone_number=phone_number)
    finally:
        with task_lock:
            if not task_queue.empty():
                task_queue.get()
            current_task = None
        if ENABLE_IP_RESTRICTION:
            with ip_lock:
                active_ip_requests.pop(ip_address, None)
        update_queue_positions()
        if not task_queue.empty():
            next_task = task_queue.queue[0]
            next_ip = next_task.get('ip_address', 'unknown')
            threading.Thread(target=process_task, args=(next_task, phone_number, next_ip)).start()

def update_task_status(task_id, status, progress, **kwargs):
    with task_lock:
        task_status[task_id] = {
            "status": status,
            "progress": progress,
            **kwargs
        }
    # logger.info(f"任务 {task_id} 状态更新: {status}, 进度: {progress}%")

def set_model_and_lora(task):
    options_payload = {
        "sd_model_checkpoint": SD_MODEL,
    }
    
    if "<lora:" in task['model']:
        lora_info = task['model'].split("<lora:")[1].split(">")[0]
        lora_name, lora_weight = lora_info.split(":")
        if not lora_name.endswith('.safetensors'):
            lora_name += '.safetensors'
        options_payload["sd_lora"] = f"{lora_name}:{lora_weight}"
    
    options_url = f"{SD_URL}/sdapi/v1/options"
    try:
        logger.info(f"设置模型和LoRA: {options_payload}")
        options_response = requests.post(url=options_url, json=options_payload, verify=False, timeout=30)
        options_response.raise_for_status()
        logger.info("成功设置模型和LoRA")
        
        # 添加3秒延迟
        logger.info("等待3秒钟以确保设置生效...")
        time.sleep(3)
        logger.info("延迟结束，继续处理")
    except requests.exceptions.RequestException as e:
        logger.error(f"设置模型和LoRA失败: {str(e)}")
        raise Exception(f"设置模型和LoRA失败: {str(e)}")

def generate_images(task):
    # 首先设置模型和LoRA
    set_model_and_lora(task)

    # 然后生成图像
    payload = {
        "prompt": task['prompt'],
        "negative_prompt": task['negative_prompt'],
        "steps": 30,
        "sampler_name": "Euler",
        "scheduler": "Simple",
        "cfg_scale": 1,
        "width": task['width'],
        "height": task['height'],
        "seed": task['seed'],
        "batch_size": task['num_images'],
    }

    logger.debug(f"Payload: {json.dumps(payload, indent=2)}")

    update_task_status(task['task_id'], f"正在使用模型 {SD_MODEL} 生成图片...", 0)
    try:
        logger.info(f"发送请求到 {SD_URL}/sdapi/v1/txt2img")
        response = requests.post(url=f'{SD_URL}/sdapi/v1/txt2img', json=payload, verify=False, timeout=120)
        response.raise_for_status()
        r = response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"生成图片请求失败: {str(e)}")
        raise Exception(f"生成图片请求失败: {str(e)}")

    if 'images' not in r:
        logger.error("响应中没有 'images' 键")
        raise Exception("响应中没有 'images' 键")

    info = r.get('info', '{}')
    if isinstance(info, str):
        try:
            info = json.loads(info)
        except json.JSONDecodeError:
            logger.error("无法解析 'info' 字符串为 JSON")
            info = {}

    seeds = info.get('all_seeds', [task['seed']] * task['num_images'])
    images = r['images']
    logger.info(f"生成的图片数量: {len(images)}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    task_output_dir = os.path.join(OUTPUT_DIR, task['task_id'])
    os.makedirs(task_output_dir, exist_ok=True)

    saved_files = []
    ai_response_content = '### 生成的图片\n\n'
    ai_response_content += f'**Prompt:** {task["prompt"]}\n\n'
    ai_response_content += '<div class="container_sd">\n'

    for i, img_data in enumerate(images):
        progress = int((i + 1) / task['num_images'] * 100)
        update_task_status(task['task_id'], f"处理图片 {i+1}/{task['num_images']}", progress)

        if not isinstance(img_data, str) or not img_data.strip():
            logger.warning(f"图片 {i+1} 的数据无效")
            continue

        try:
            image_data = base64.b64decode(img_data)
            image = Image.open(io.BytesIO(image_data))
            file_name = f"{timestamp}_{task['model']}_{seeds[i]}.png"
            file_path = os.path.join(task_output_dir, file_name)
            image.save(file_path)
            saved_files.append(file_name)

            relative_path = f"/images/sd/{task['task_id']}/{file_name}"
            ai_response_content += f'<img src="{relative_path}" alt="Generated image {i+1}">\n'

            logger.info(f"图片 {i+1} 已保存")
        except Exception as e:
            logger.error(f"处理图片 {i+1} 时出错: {str(e)}")

    ai_response_content += '</div>\n\n'
    ai_response_content += f'**Seeds:** {", ".join(map(str, seeds))}\n\n'

    # 保存到数据库
    new_topic_start_time = datetime.now().isoformat()
    # try:
    #     insert_topic(f'sd_{prompt}', new_topic_start_time, phone_number)
    #     logger.info("成功将prompt保存为新的topic")

    #     dialog_assistant = {
    #         "model": model,
    #         "role": "assistant",
    #         "content": ai_response_content,
    #         "this_message_time": new_topic_start_time,
    #     }

    #     insert_single_dialogue(dialog_assistant, new_topic_start_time, phone_number)
    #     logger.info("成功将图片信息、prompt和seed保存到数据库")
    # except Exception as e:
    #     logger.error(f"保存到数据库时出错: {str(e)}")

    update_task_status(task['task_id'], "所有图片生成完成", 100)
    return seeds, saved_files, new_topic_start_time

def check_prompt_with_chatgpt(prompt):
    try:
        logger.info(f"正在检查提示词: {prompt}")
        response = client.chat.completions.create(
            model=CHATGPT_MODEL,
            messages=[
                {"role": "system", "content": CONTENT_REVIEW_PROMPT},
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
        return False  # 如果API调用失败，我们假设内容是安全的

def translate_to_english(prompt):
    try:
        logger.info(f"正在将提示词翻译为英语: {prompt}")
        response = client.chat.completions.create(
            model=CHATGPT_MODEL,
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
        return prompt  # 如果API调用失败，返回原始prompt

@app.route('/')
def index():
    return send_from_directory('static', 'index_m.html')

def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0]
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    else:
        return request.remote_addr


    
@app.route('/sd/generate', methods=['POST'])
def generate():
    logger.info("收到生成图片请求")
    data = request.json
    logger.debug(f"请求数据: {json.dumps(data, indent=2)}")

    # 获取请求的 IP 地址
    ip_address = get_client_ip()
    logger.info(f"请求 IP 地址: {ip_address}")

    # 只在启用 IP 限制时检查
    if ENABLE_IP_RESTRICTION:
        with ip_lock:
            if ip_address in active_ip_requests:
                return jsonify({"error": "您已有一个活跃请求，请等待当前请求完成后再试"}), 429
            active_ip_requests[ip_address] = True

    phone_number = request.cookies.get('phoneNumber')
    logger.info(f'*****phoneNumber: {phone_number}')

    prompt = data.get('prompt', '')
    if not prompt:
        return jsonify({"error": "提示词不能为空"}), 400

    try:
        contains_inappropriate_content = check_prompt_with_chatgpt(prompt)
        if contains_inappropriate_content:
            return jsonify({"error": "提示词可能包含不适当的内容。请修改后重试。"}), 400

        translated_prompt = translate_to_english(prompt)
    except Exception as e:
        logger.error(f"处理提示词时出错: {str(e)}")
        return jsonify({"error": "处理提示词时出现错误，请稍后重试。"}), 500

    task_id = str(uuid4())
    
    # 构建模型参数
    model_params = SD_MODEL
    if data.get('lora', False):
        lora_name = data.get('lora_name', '')
        lora_weight = data.get('lora_weight', 0.7)  # 默认权重为0.7
        model_params += f"<lora:{lora_name}:{lora_weight}>"

    task = {
        'task_id': task_id,
        'model': model_params,
        'prompt': translated_prompt,
        'negative_prompt': data.get('negative_prompt', 'NSFW'),
        'width': data.get('width', 512),
        'height': data.get('height', 512),
        'num_images': data.get('num_images', 1),
        'seed': data.get('seed', -1),
        'ip_address': ip_address
    }

    if task_queue.qsize() >= MAX_QUEUE_SIZE:
        if ENABLE_IP_RESTRICTION:
            with ip_lock:
                del active_ip_requests[ip_address]
        return jsonify({"error": "队列已满，请稍后再试"}), 429

    queue_position = task_queue.qsize()
    task_queue.put(task)
    task_status[task_id] = {"status": "排队中" if queue_position > 0 else "处理中", "progress": 0, "queuePosition": queue_position}

    if queue_position == 0:
        threading.Thread(target=process_task, args=(task, phone_number, ip_address)).start()

    return jsonify({"task_id": task_id, "queuePosition": queue_position})

@app.route('/sd/status/<task_id>', methods=['GET'])
def get_status(task_id):
    # logger.info(f"收到任务 {task_id} 的状态请求")
    status = task_status.get(task_id, {"status": "未知任务", "progress": 0})
    if status["status"] == "排队中":
        status["queuePosition"] = next((i for i, task in enumerate(list(task_queue.queue)) if task['task_id'] == task_id), -1)
    # logger.debug(f"任务 {task_id} 状态: {status}")
    return jsonify(status)

@app.route('/images/sd/<task_id>/<path:filename>')
def serve_image(task_id, filename):
    logger.info(f"请求图片: {filename}")
    return send_from_directory(os.path.join(OUTPUT_DIR, task_id), filename)

if __name__ == '__main__':
    logger.info("启动服务器")
    app.run(host='0.0.0.0', port=25001, threaded=True)
