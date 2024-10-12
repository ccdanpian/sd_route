import requests
import base64
from PIL import Image
from io import BytesIO
import json
import os
import logging
from datetime import datetime

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 定义 API URL
API_URL = "https://sd.italkwithai.online:21443/sdapi/v1/img2img"
API_OPTIONS_URL = "https://sd.italkwithai.online:21443/sdapi/v1/options"

def set_model(model_name):
    options_payload = {
        "sd_model_checkpoint": model_name
    }
    response = requests.post(API_OPTIONS_URL, json=options_payload, verify=False)
    response.raise_for_status()
    logger.info(f"模型已设置为: {model_name}")

def encode_image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def inpaint_image(original_image_path, mask_image_path, prompt, output_path, model_name):
    # 设置模型
    set_model(model_name)

    # 读取并编码图片
    original_image = encode_image_to_base64(original_image_path)
    mask_image = encode_image_to_base64(mask_image_path)

    # 构建payload
    payload = {
        "init_images": [original_image],
        "mask": mask_image,
        "prompt": prompt,
        "negative_prompt": "",
        "seed": -1,  # -1 表示随机种子
        "batch_size": 1,
        "n_iter": 1,  # 对应 Batch count
        "steps": 30,
        "cfg_scale": 7,
        "width": 512,
        "height": 512,
        "resize_mode": 0,  # 0: Just resize, 1: Crop and resize, 2: Resize and fill, 3: Just resize (latent upscale)
        "mask_blur": 4,
        "inpainting_fill": 1,  # 0: fill, 1: original, 2: latent noise, 3: latent nothing
        "inpaint_full_res": True,  # 对应 "Whole picture"
        "inpaint_full_res_padding": 32,
        "sampler_name": "Euler",
        "sampler_index": "Euler",
        "denoising_strength": 0.75,
        "mask_mode": 0,  # 0: Inpaint masked, 1: Inpaint not masked
        "inpainting_mask_invert": 0,  # 0: Inpaint masked, 1: Inpaint not masked
        "override_settings": {
            "sd_model_checkpoint": model_name
        },
        "override_settings_restore_afterwards": True,
        "script_args": [],  # 如果使用脚本，在这里添加脚本参数
        "sampler_index": "Euler",
        "include_init_images": False,
        "script_name": "",
        "send_images": True,
        "save_images": False,
        "alwayson_scripts": {}
    }

    try:
        logger.info(f"发送请求到 {API_URL}")
        response = requests.post(API_URL, json=payload, verify=False, timeout=120)
        response.raise_for_status()
        result = response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"图片修复请求失败: {str(e)}")
        raise Exception(f"图片修复请求失败: {str(e)}")

    if 'images' not in result:
        logger.error("响应中没有 'images' 键")
        raise Exception("响应中没有 'images' 键")

    images = result['images']
    logger.info(f"生成的图片数量: {len(images)}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(output_path, exist_ok=True)

    for i, img_data in enumerate(images):
        if not isinstance(img_data, str) or not img_data.strip():
            logger.warning(f"图片 {i+1} 的数据无效")
            continue

        try:
            image_data = base64.b64decode(img_data)
            image = Image.open(BytesIO(image_data))
            file_name = f"{timestamp}_inpainted_{model_name}_{i+1}.png"
            file_path = os.path.join(output_path, file_name)
            image.save(file_path)
            logger.info(f"图片 {i+1} 已保存到 {file_path}")
        except Exception as e:
            logger.error(f"处理图片 {i+1} 时出错: {str(e)}")

    logger.info("图片修复完成")

# 示例调用
original_image = "11.png"  # 原始图像路径
mask_image = "mask.png"        # 蒙版图像路径（白色区域为需要重绘部分）
prompt_text = "a dog with red eyes"        # 提示词
output_image = "inpaint_result.png"          # 输出图像路径
model_name = "realisticVisionV51_v51VAE.safetensors"  # 替换为你想使用的模型名称

inpaint_image(original_image, mask_image, prompt_text, output_image, model_name)
