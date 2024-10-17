from flask import Flask, request, jsonify, send_from_directory, make_response, session, redirect, url_for, after_this_request
from flask_cors import CORS
from functools import wraps
import requests
import io
from io import BytesIO
import base64
from PIL import Image
import os
import random
from datetime import datetime, timedelta
import threading
import time
import json
import logging
import urllib3
from uuid import uuid4
from queue import Queue
from openai import OpenAI
from dotenv import load_dotenv
import secrets
from urllib.parse import urlencode
import jwt
from flask_sqlalchemy import SQLAlchemy

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 设置日志
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, supports_credentials=True)

# 设置 secret key
app.secret_key = os.environ.get('FLASK_SECRET_KEY') or secrets.token_hex(16)

# 从环境变量获取配置
load_dotenv()
SD_URL = os.getenv('SD_URL', 'https://127.0.0.1:7860')
OUTPUT_DIR = os.getenv('SD_OUTPUT_DIR', 'output')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_API_BASE = os.getenv('OPENAI_API_BASE')
ENABLE_IP_RESTRICTION = os.getenv('ENABLE_IP_RESTRICTION', 'False').lower() == 'true'
CHATGPT_MODEL = os.getenv('CHATGPT_MODEL', 'gpt-4o-mini-2024-07-18')
CONTENT_REVIEW_PROMPT = os.getenv('CONTENT_REVIEW_PROMPT', '你是一个内容审核助手。请判断以下提示词是否包含身体敏感部位未被遮挡、或中国国家领导人信息。只回答"是"或"否"，不要解释。')
MAX_QUEUE_SIZE = int(os.getenv('MAX_QUEUE_SIZE', '3'))
SD_MODEL = os.getenv('SD_MODEL', 'v1-5-pruned-emaonly.safetensors')
AUTH_SERVICE_URL = os.getenv('AUTH_SERVICE_URL', 'http://localhost:25002')
JWT_SECRET = os.getenv('JWT_SECRET')
JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

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

def process_task(task, user_id, ip_address):
    task_id = task['task_id']
    logger.info(f"Processing task {task_id} for user {user_id}")
    
    try:
        if task['type'] == 'inpaint':
            logger.info(f"Starting inpainting task {task_id}")
            result = inpaint_image(task)
            if 'error' in result:
                logger.error(f"Inpainting task {task_id} failed: {result['error']}")
                update_task_status(task_id, f"重绘失败: {result['error']}", 100, user_id=user_id)
            else:
                logger.info(f"Inpainting task {task_id} completed successfully")
                update_task_status(task_id, "重绘完成", 100, 
                                   inpainted_image_url=result['inpainted_image_url'],
                                   file_name=result['file_name'],
                                   save_time=result['save_time'],
                                   inpaint_prompt=result['inpaint_prompt'],
                                   user_id=user_id)
        elif task['type'] == 'generate':
            logger.info(f"Starting image generation task {task_id}")
            seeds, file_names, save_time = generate_images(task)
            logger.info(f"Image generation task {task_id} completed")
            update_task_status(task_id, "完成", 100, seeds=seeds, file_names=file_names, translated_prompt=task['prompt'], user_id=user_id, save_time=save_time)
        else:
            logger.error(f"Unknown task type for task {task_id}: {task['type']}")
            raise ValueError(f"未知的任务类型: {task['type']}")
    except Exception as e:
        logger.error(f"Error processing task {task_id}: {str(e)}")
        update_task_status(task_id, f"失败: {str(e)}", 100, user_id=user_id)
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
            logger.info(f"Starting next task in queue: {next_task['task_id']}")
            threading.Thread(target=process_task, args=(next_task, session['user_id'], next_ip)).start()

def update_task_status(task_id, status, progress, **kwargs):
    with task_lock:
        task_status[task_id] = {
            "status": status,
            "progress": progress,
            **kwargs
        }
    # logger.info(f"更新任务状态: task_id={task_id}, status={status}, progress={progress}, extra_info={kwargs}")

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
        # logger.info(f"设置模型和LoRA: {options_payload}")
        options_response = requests.post(url=options_url, json=options_payload, verify=False, timeout=30)
        options_response.raise_for_status()
        # logger.info("成功设置模型和LoRA")
        
        # 添加3秒延迟
        # logger.info("等待3秒钟以确保设置生效...")
        time.sleep(3)
        # logger.info("延迟结束，继续处理")
    except requests.exceptions.RequestException as e:
        # logger.error(f"设置模型和LoRA失败: {str(e)}")
        raise Exception(f"设置模型和LoRA失败: {str(e)}")

def generate_images(task):
    # 首先设置模型和LoRA
    set_model_and_lora(task)

    # 然后生成图像
    payload = {
        "prompt": task['prompt'],
        "negative_prompt": task['negative_prompt'],
        "steps": task['steps'],  # 使用传入的 steps，如果没有则默认为 15
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
        # logger.info(f"送请到 {SD_URL}/sdapi/v1/txt2img")
        response = requests.post(url=f'{SD_URL}/sdapi/v1/txt2img', json=payload, verify=False, timeout=120)
        response.raise_for_status()
        r = response.json()
    except requests.exceptions.RequestException as e:
        # logger.error(f"生成图片请求失败: {str(e)}")
        raise Exception(f"生成图片请求失败: {str(e)}")

    if 'images' not in r:
        # logger.error("响应中没有 'images' 键")
        raise Exception("响应中没有 'images' 键")

    info = r.get('info', '{}')
    if isinstance(info, str):
        try:
            info = json.loads(info)
        except json.JSONDecodeError:
            # logger.error("无法解析 'info' 字符串为 JSON")
            info = {}

    seeds = info.get('all_seeds', [task['seed']] * task['num_images'])
    images = r['images']
    # logger.info(f"生成的图片数量: {len(images)}")

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
            # logger.warning(f"图片 {i+1} 的数据无效")
            continue

        try:
            image_data = base64.b64decode(img_data)
            image = Image.open(io.BytesIO(image_data))
            file_name = f"{timestamp}_{seeds[i]}.png"
            file_path = os.path.join(task_output_dir, file_name)
            image.save(file_path)
            saved_files.append(file_name)

            relative_path = f"/images/sd/{task['task_id']}/{file_name}"
            ai_response_content += f'<img src="{relative_path}" alt="Generated image {i+1}">\n'

            # logger.info(f"图片 {i+1} 已保存")
        except Exception as e:
            logger.error(f"处理图片 {i+1} 时出错: {str(e)}")

    ai_response_content += '</div>\n\n'
    ai_response_content += f'**Seeds:** {", ".join(map(str, seeds))}\n\n'

    # 保存到数据库
    new_topic_start_time = datetime.now().isoformat()
    # try:
    #     insert_topic(f'sd_{prompt}', new_topic_start_time, phone_number)
    #     logger.info("成功将prompt保存为的topic")

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
        # logger.info(f"正在检查提示词: {prompt}")
        response = client.chat.completions.create(
            model=CHATGPT_MODEL,
            messages=[
                {"role": "system", "content": CONTENT_REVIEW_PROMPT},
                {"role": "user", "content": f"提示词: {prompt}"}
            ]
        )
        # logger.debug(f"ChatGPT API 原始响应: {response}")
        
        if not response.choices:
            # logger.error("ChatGPT API 响应中没有选项")
            return False

        result = response.choices[0].message.content.strip().lower()
        # logger.info(f"ChatGPT 审核结: {result}")
        return result == '是'
    except Exception as e:
        # logger.error(f"ChatGPT API调用错误: {str(e)}")
        return False  # 如果API调用失败，我们假设内容是安全的

def translate_to_english(prompt):
    try:
        # logger.info(f"正在将提示词翻译为英语: {prompt}")
        response = client.chat.completions.create(
            model=CHATGPT_MODEL,
            messages=[
                {"role": "system", "content": "你是一个翻译助手。请将给定的文本翻译成英语。如果文本已经是英语，请原样返回。只返回翻译结果，不要添加任何解释、引号或额外的文字。"},
                {"role": "user", "content": prompt}
            ]
        )
        
        if not response.choices:
            # logger.error("ChatGPT API 响应中没有选项")
            return prompt

        translated_prompt = response.choices[0].message.content.strip()
        # logger.info(f"翻译结果: {translated_prompt}")
        return translated_prompt
    except Exception as e:
        # logger.error(f"ChatGPT API调用错误: {str(e)}")
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

@app.before_request
def log_request_info():
    ip = get_client_ip()
    logger.info(f'Request from IP: {ip}, Path: {request.path}, Method: {request.method}')

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        logger.info("开始验证用户认证")
        jwt_token = request.cookies.get('jwt_token') or session.get('jwt_token')
        logger.info(f"***JWT token: {jwt_token}")
        
        if not jwt_token:
            logger.warning("JWT 令牌缺失")
            return jsonify({"error": "未登录"}), 401

        try:
            logger.info("尝试解码和验证 JWT")
            logger.info(f"使用的 JWT_SECRET: {JWT_SECRET[:5]}...") # 只记录前几个字符
            logger.info(f"使用的 JWT_ALGORITHM: {JWT_ALGORITHM}")
            
            # 解码和验证 JWT
            payload = jwt.decode(jwt_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            logger.info(f"JWT 成功解码，payload: {payload}")
            
            user_info = payload.get('user_info', {})
            original_access_token = payload.get('access_token')
            
            logger.info(f"JWT 验证成功，用户ID: {user_info.get('id')}")
            # 更新 session 中的用户信息
            session['user_info'] = user_info
            session['user_id'] = user_info.get('id')
            session['access_token'] = original_access_token  # 保存原始 access token
        except jwt.ExpiredSignatureError:
            logger.warning("JWT 已过期，尝试刷新")
            # 尝试刷新令牌
            new_jwt = refresh_jwt_token()
            if new_jwt:
                logger.info("JWT 刷新成功")
                session['jwt_token'] = new_jwt
                response = make_response(f(*args, **kwargs))
                response.set_cookie('jwt_token', new_jwt, 
                                    max_age=3600*24*7, httponly=False, secure=False, samesite='Lax')
                return response
            else:
                logger.error("JWT 刷新失败")
                return jsonify({"error": "登录已过期"}), 401
        except jwt.InvalidTokenError as e:
            logger.error(f"无效的 JWT: {str(e)}")
            return jsonify({"error": "登录已过期"}), 401

        logger.info("认证成功，继续处理请求")
        return f(*args, **kwargs)

    return decorated

def check_token(token):
    try:
        response = requests.post(f"{AUTH_SERVICE_URL}/oauth2/validate", json={"access_token": token})
        if response.status_code == 200:
            user_info = response.json().get('user_info')
            if user_info:
                session.update(user_info)
                return True
        return False
    except requests.RequestException:
        return False

@app.route('/sd/generate', methods=['POST'])
@require_auth
def generate():
    logger.info("收到生成图片请求")
    user_info = session.get('user_info', {})
    if not user_info:
        logger.warning(f"用户的会话中没有用户信息")
        return jsonify({"error": "无法获取用户信息"}), 403

    if not user_info.get('active', False) or user_info.get('silenced', False) or user_info.get('trust_level', 0) < 2:
        logger.warning(f"用户 {user_info.get('id')} 没有权限生成图片")
        return jsonify({"error": "您没有权限使用此功能"}), 403
    
    data = request.json
    logger.debug(f"请求数据: {json.dumps(data, indent=2)}")

    ip_address = get_client_ip()
    logger.info(f"请求 IP 地址: {ip_address}")

    # 只在启用 IP 限制时检查
    if ENABLE_IP_RESTRICTION:
        with ip_lock:
            if ip_address in active_ip_requests:
                return jsonify({"error": "您已有一个活跃请求，请等待当前请求完成后再试"}), 429
            active_ip_requests[ip_address] = True

    prompt = data.get('prompt', '')
    if not prompt:
        if ENABLE_IP_RESTRICTION:
            with ip_lock:
                active_ip_requests.pop(ip_address, None)
        return jsonify({"error": "提示词不能为空"}), 400

    try:
        contains_inappropriate_content = check_prompt_with_chatgpt(prompt)
        if contains_inappropriate_content:
            if ENABLE_IP_RESTRICTION:
                with ip_lock:
                    active_ip_requests.pop(ip_address, None)
            return jsonify({"error": "提示词可能包含不适当的内容。请修改后重试。"}), 400

        translated_prompt = translate_to_english(prompt)

        # 构建模型参数
        model_params = SD_MODEL
        if data.get('lora', False):
            lora_name = data.get('lora_name', '')
            lora_weight = data.get('lora_weight', 0.7)  # 默认权重为0.7
            model_params += f"<lora:{lora_name}:{lora_weight}>"
            # 将 lora 信息添加到 prompt 中
            translated_prompt += f", <lora:{lora_name}:{lora_weight}>"

        task_id = str(uuid4())

        task = {
            'task_id': task_id,
            'type': 'generate',
            'model': model_params,
            'prompt': translated_prompt,
            'negative_prompt': data.get('negative_prompt', 'NSFW'),
            'steps': data.get('steps', 15),  # 添加步数，默认为15
            'width': data.get('width', 512),
            'height': data.get('height', 512),
            'num_images': data.get('num_images', 1),
            'seed': data.get('seed', -1),
            'ip_address': ip_address
        }

        if task_queue.qsize() >= MAX_QUEUE_SIZE:
            if ENABLE_IP_RESTRICTION:
                with ip_lock:
                    active_ip_requests.pop(ip_address, None)
            return jsonify({"error": "队列已满，请稍后再试"}), 429

        queue_position = task_queue.qsize()
        task_queue.put(task)
        task_status[task_id] = {"status": "排队中" if queue_position > 0 else "处理中", "progress": 0, "queuePosition": queue_position}

        if queue_position == 0:
            threading.Thread(target=process_task, args=(task, session['user_id'], ip_address)).start()

        return jsonify({"task_id": task_id, "queuePosition": queue_position})
    except Exception as e:
        logger.error(f"处理提示词时出错: {str(e)}")
        if ENABLE_IP_RESTRICTION:
            with ip_lock:
                active_ip_requests.pop(ip_address, None)
        return jsonify({"error": "处理提示词时出现错误，请稍后重试。"}), 500

@app.route('/sd/status/<task_id>', methods=['GET'])
@require_auth
def get_status(task_id):
    logger.info(f"Received status request for task {task_id}")
    status = task_status.get(task_id, {"status": "未知任务", "progress": 0})
    if status["status"] == "排队中":
        status["queuePosition"] = next((i for i, task in enumerate(list(task_queue.queue)) if task['task_id'] == task_id), -1)
    # logger.debug(f"任务 {task_id} 状态: {status}")
    return jsonify(status)

@app.route('/images/sd/<task_id>/<path:filename>')
def serve_image(task_id, filename):
    logger.info(f"请求图片: {filename}")
    return send_from_directory(os.path.join(OUTPUT_DIR, task_id), filename)

# 添加这个新函数到文件中
def encode_image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

# 假设我们有一个全局变量来控制调试模式
DEBUG_MODE = True  # 在生产环境中应设置 False

def save_debug_image(image_data, filename):
    if not DEBUG_MODE:
        return
    debug_dir = "debug_images"
    os.makedirs(debug_dir, exist_ok=True)
    file_path = os.path.join(debug_dir, filename)
    with open(file_path, "wb") as f:
        f.write(image_data)
    logger.debug(f"保存调试图片: {file_path}")

def get_image_dimensions(image_data):
    with Image.open(BytesIO(image_data)) as img:
        return img.size

# 添加新的 inpaint 路由
@app.route('/sd/inpaint', methods=['POST'])
@require_auth
def inpaint():
    logger.info("收到图片重绘请求")
    
    user_info = session.get('user_info', {})
    if not user_info:
        logger.warning("无法获取用户信息")
        return jsonify({"error": "无法获取用户信息"}), 403

    if not user_info.get('active', False) or user_info.get('silenced', False) or user_info.get('trust_level', 0) < 2:
        logger.warning(f"用户 {user_info.get('id')} 没有权限使用重绘功能")
        return jsonify({"error": "您没有权限使用此功能"}), 403
    
    data = request.json
    logger.info(f"请求数据: prompt={data.get('prompt')}, model_name={data.get('model_name')}")

    ip_address = get_client_ip()
    logger.info(f"请求 IP 地址: {ip_address}")

    # 只在启用 IP 限制时检查
    if ENABLE_IP_RESTRICTION:
        with ip_lock:
            if ip_address in active_ip_requests:
                return jsonify({"error": "您已有一个活跃请求，请等待当前请求完成后再试"}), 429
            active_ip_requests[ip_address] = True

    prompt = data.get('prompt', '')
    if not prompt:
        if ENABLE_IP_RESTRICTION:
            with ip_lock:
                active_ip_requests.pop(ip_address, None)
        return jsonify({"error": "提示词不能为空"}), 400

    try:
        contains_inappropriate_content = check_prompt_with_chatgpt(prompt)
        if contains_inappropriate_content:
            if ENABLE_IP_RESTRICTION:
                with ip_lock:
                    active_ip_requests.pop(ip_address, None)
            return jsonify({"error": "提示词可能包含不适当的内容。请修改后重试。"}), 400

        translated_prompt = translate_to_english(prompt)

        task_id = str(uuid4())
        logger.info(f"创建新的重绘任务: task_id={task_id}")

        task = {
            'task_id': task_id,
            'type': 'inpaint',
            'prompt': translated_prompt,
            'negative_prompt': data.get('negative_prompt', ''),
            'steps': data.get('steps', 30),
            'original_image': data.get('original_image'),
            'mask_image': data.get('mask_image'),
            'model_name': data.get('model_name', "realisticVisionV51_v51VAE.safetensors"),
            'model': SD_MODEL,
            'ip_address': ip_address
        }

        # 如果有 LoRA 信息，也添加到任务中
        if data.get('lora', False):
            lora_name = data.get('lora_name', '')
            lora_weight = data.get('lora_weight', 0.7)
            task['model'] += f"<lora:{lora_name}:{lora_weight}>"

        if task_queue.qsize() >= MAX_QUEUE_SIZE:
            if ENABLE_IP_RESTRICTION:
                with ip_lock:
                    active_ip_requests.pop(ip_address, None)
            return jsonify({"error": "队列已满，请稍后再试"}), 429

        queue_position = task_queue.qsize()
        task_queue.put(task)
        task_status[task_id] = {"status": "排队中" if queue_position > 0 else "处理中", "progress": 0, "queuePosition": queue_position}

        if queue_position == 0:
            threading.Thread(target=process_task, args=(task, session['user_id'], ip_address)).start()

        return jsonify({"task_id": task_id, "status": "pending"})
    except Exception as e:
        logger.error(f"处理提示词时出错: {str(e)}")
        if ENABLE_IP_RESTRICTION:
            with ip_lock:
                active_ip_requests.pop(ip_address, None)
        return jsonify({"error": "处理提示词时出现错误，请稍后重试。"}), 500

@app.route('/sd/task_status/<task_id>', methods=['GET'])
@require_auth
def get_task_status(task_id):
    logger.info(f"Received task status request for task {task_id}")
    status = task_status.get(task_id, {"status": "未知任务", "progress": 0})
    logger.info(f"获取任务状态: task_id={task_id}, status={status}")
    return jsonify(status)

# 新增路由：获取当前用户息
@app.route('/user/info', methods=['GET'])
@require_auth
def get_user_info():
    logger.info(f"收到用户信息请求: user_id={session['user_id']}")
    user_info = session.get('user_info', {})
    if not user_info:
        logger.warning(f"用户 {session['user_id']} 的会话中没有用户信息")
        return jsonify({"error": "User information not found"}), 404
    
    # 只返回必要的信息
    safe_user_info = {
        "id": user_info.get('id'),
        "username": user_info.get('username'),
        "avatar_url": user_info.get('avatar_url'),
        "name": user_info.get('name'),
        "active": user_info.get('active'),
        "trust_level": user_info.get('trust_level'),
        "silenced": user_info.get('silenced')
    }
    logger.debug(f"返回用户信息: {safe_user_info}")
    return jsonify(safe_user_info)

# 修改 inpaint_image 函数以返回结果不是直接响应
def inpaint_image(task):
    task_id = task['task_id']
    logger.info(f"开始重绘任务: task_id={task_id}")
    update_task_status(task_id, "重中...", 0)
    
    prompt = task.get('prompt')
    original_image = task.get('original_image')
    mask_image = task.get('mask_image')
    model_name = task.get('model_name')
    steps = min(task.get('steps') + 6, 36)

    logger.info(f"重绘任务参数: task_id={task_id}, prompt={prompt}, model_name={model_name}, steps={steps}")

    # 创时目录来保存图片
    temp_dir = f"temp_{task_id}"
    os.makedirs(temp_dir, exist_ok=True)

    try:
        # 保存原始图片和遮罩图片
        original_image_path = os.path.join(temp_dir, "original.png")
        mask_image_path = os.path.join(temp_dir, "mask.png")

        # 从 base64 解码并保存图片
        with open(original_image_path, "wb") as f:
            f.write(base64.b64decode(original_image.split(',')[1]))
        with open(mask_image_path, "wb") as f:
            f.write(base64.b64decode(mask_image.split(',')[1]))

        # 重新编码图片为 base64
        original_image_b64 = encode_image_to_base64(original_image_path)
        mask_image_b64 = encode_image_to_base64(mask_image_path)

        # 获取图片尺寸
        with Image.open(original_image_path) as img:
            original_width, original_height = img.size

        logger.info(f"原始图片尺寸: {original_width}x{original_height}")

        update_task_status(task_id, "正在设置模型", 10)
        # 设置模型和LoRA
        set_model_and_lora(task)

        # 构建 payload
        payload = {
            "init_images": [original_image_b64],
            "mask": mask_image_b64,
            "prompt": prompt,
            "negative_prompt": "",
            "seed": -1,
            "batch_size": 1,
            "n_iter": 1,
            "steps": steps,  # 使用传入的 steps，如果没有则默认为 30
            "cfg_scale": 1,
            "width": original_width,
            "height": original_height,
            "resize_mode": 0,
            "mask_blur": 4,
            "inpainting_fill": 1,
            "inpaint_full_res": True,
            "inpaint_full_res_padding": 32,
            "sampler_name": "Euler",
            "sampler_index": "Euler",
            "scheduler": "Simple",
            "denoising_strength": 0.75,
            "mask_mode": 0,
            "inpainting_mask_invert": 0,
            "override_settings": {
                "sd_model_checkpoint": model_name
            },
            "override_settings_restore_afterwards": True,
            "script_args": [],
            "include_init_images": False,
            "script_name": "",
            "send_images": True,
            "save_images": False,
            "alwayson_scripts": {}
        }

        update_task_status(task_id, "正在发送重绘请求", 30)
        # 发送请求到 SD API
        logger.info(f"准备发送重绘请求到 {SD_URL}")
        response = requests.post(url=f'{SD_URL}/sdapi/v1/img2img', json=payload, verify=False, timeout=120)
        response.raise_for_status()
        result = response.json()

        if 'images' not in result or not result['images']:
            logger.error("响应中没有有效的图片数据")
            raise Exception("响应中没有有效的图片数据")

        update_task_status(task_id, "正在处理重绘结果", 70)
        inpainted_image = result['images'][0]
        logger.info("图片重绘成功完成")

        # 保存重绘后的图片
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        save_dir = os.path.join(OUTPUT_DIR, task_id)
        os.makedirs(save_dir, exist_ok=True)
        file_name = f"{timestamp}_inpaint.png"
        save_path = os.path.join(save_dir, file_name)
        
        with open(save_path, "wb") as f:
            f.write(base64.b64decode(inpainted_image))

        logger.info(f"重绘图片已保存: {save_path}")

        # 构建图片URL
        image_url = f"/images/sd/{task_id}/{file_name}"

        logger.info(f"重绘任务完成: task_id={task_id}")
        update_task_status(task_id, "重绘完成", 100, inpainted_image_url=image_url)

        return {
            "inpainted_image_url": image_url,
            "message": "图片重绘完成",
            "file_name": file_name,
            "save_time": timestamp,
            "inpaint_prompt": task['prompt']  # 添加这行
        }

    except Exception as e:
        error_msg = f"处理重绘任务时出错: {str(e)}"
        logger.error(f"{error_msg} task_id={task_id}")
        update_task_status(task_id, "重绘失败", 100, error=error_msg)
        return {"error": error_msg}
    finally:
        # 清理临时文件
        for file in os.listdir(temp_dir):
            os.remove(os.path.join(temp_dir, file))
        os.rmdir(temp_dir)

@app.route('/login')
def login():
    logger.info("用户请求登录")
    auth_response = requests.get(f"{AUTH_SERVICE_URL}/oauth/authorize")
    if auth_response.status_code == 200:
        auth_data = auth_response.json()
        logger.info(f"重定向到认证服务的授权 URL: {auth_data['auth_url']}")
        return redirect(auth_data['auth_url'])
    else:
        logger.error("启动认证过程失败")
        return jsonify({"error": "Failed to start authentication process"}), 500

@app.route('/auth/complete')
def auth_complete():
    logger.info("收到认证完成回调")
    temp_token = request.args.get('token')
    if not temp_token:
        logger.warning("未提供临时令牌")
        return jsonify({"error": "No token provided"}), 400

    logger.info("使用临时令牌获取用户信息")
    user_info_response = requests.post(f"{AUTH_SERVICE_URL}/oauth/userinfo", 
                                       json={"temp_token": temp_token})
    if user_info_response.status_code != 200:
        logger.error(f"获取用户信息失败: {user_info_response.text}")
        return jsonify({"error": "Failed to get user info"}), 400

    user_data = user_info_response.json()
    
    # 创建 JWT
    expiration_time = datetime.utcnow() + timedelta(days=7)
    payload = {
        'user_info': user_data['user_info'],
        'access_token': user_data['access_token'],  # 存储原始 access token
        'exp': expiration_time
    }
    jwt_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    # 保存 JWT 和其他信息
    session['jwt_token'] = jwt_token
    session['access_token'] = user_data['access_token']  # 保存原始 access token
    session['refresh_token'] = user_data['refresh_token']
    session['token_expiry'] = expiration_time.isoformat()
    session['user_info'] = user_data['user_info']
    session['user_id'] = user_data['user_info']['id']
    session['user_name'] = user_data['user_info']['username']

    logger.info(f"用户 {user_data['user_info']} 已登录")
    logger.info(f"***JWT token: {jwt_token}")
    logger.info(f"***Original access token: {user_data['access_token']}")
    logger.info(f"***refresh token: {user_data['refresh_token']}")
    logger.info(f"***token_expiry: {session['token_expiry']}")

    # 创建响应对象并设置 cookie
    response = make_response()
    response.set_cookie('jwt_token', jwt_token, 
                        max_age=3600*24*7, httponly=True, secure=True, samesite='Strict')
    
    # 设置重定向
    response.headers['Location'] = url_for('index')
    response.status_code = 302  # 设置重定向状态码

    logger.info(f"认证完成，设置 cookie 并重定向到首页")
    return response

def refresh_jwt_token():
    refresh_token = session.get('refresh_token')
    if not refresh_token:
        return None

    try:
        # 向认证服务发送刷新请求
        response = requests.post(f"{AUTH_SERVICE_URL}/oauth/refresh", 
                                 json={"refresh_token": refresh_token})
        if response.status_code == 200:
            new_token_data = response.json()
            
            # 创建新的 JWT
            expiration_time = datetime.utcnow() + timedelta(days=7)
            payload = {
                'user_info': session['user_info'],
                'access_token': new_token_data['access_token'],
                'exp': expiration_time
            }
            new_jwt = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
            
            # 更新 session 中的 token 信息
            session['jwt_token'] = new_jwt
            session['access_token'] = new_token_data['access_token']
            session['refresh_token'] = new_token_data.get('refresh_token', refresh_token)
            session['token_expiry'] = expiration_time.isoformat()
            
            return new_jwt
        else:
            return None
    except requests.RequestException:
        return None

@app.route('/logout')
@require_auth
def logout():
    user_id = session.get('user_id')
    logger.info(f"用户 {user_id} 请求登出")
    logout_success = True

    if user_id:
        logout_response = requests.post(f"{AUTH_SERVICE_URL}/oauth/logout", json={"user_id": user_id})
        if logout_response.status_code == 200:
            logger.info(f"用户 {user_id} 在认证服务中成功登出")
        else:
            logger.warning(f"用户 {user_id} 在认证服务登出失败")
            logout_success = False
    
    # 清除会话
    session.clear()
    logger.info(f"用户 {user_id} 已成功从本地会话登出")
    
    @after_this_request
    def clear_cookie(response):
        response.set_cookie('jwt_token', '', expires=0, httponly=True, secure=True, samesite='Strict')
        logger.info(f"已清除用户 {user_id} 的 JWT token cookie")
        return response

    if logout_success:
        return jsonify({"success": True, "message": "登出成功"}), 200
    else:
        return jsonify({"success": False, "message": "登出部分成功，但认证服务可能未完全登出"}), 207

# 在文件顶部添加这个标志
_startup_done = False

# 替换 @app.before_first_request 的函数
def log_startup_info():
    global _startup_done
    if not _startup_done:
        logger.info("应用启动")
        # 记录其他重要的配置信息，但要注意不要记录敏感信息如密钥
        _startup_done = True

# 添加这个装饰器和函数
@app.before_request
def before_request():
    log_startup_info()

# 在文件末尾，但在 if __name__ == '__main__': 之前
with app.app_context():
    log_startup_info()

if __name__ == '__main__':
    logger.info(f"启动服务器,端口 25001, AUTH_SERVICE_URL: {AUTH_SERVICE_URL}")
    app.run(host='0.0.0.0', port=25001, threaded=True)
