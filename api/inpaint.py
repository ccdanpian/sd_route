import requests
import base64
from PIL import Image
from io import BytesIO
import urllib3

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Automatic1111 API 地址
API_URL = "https://sd.italkwithai.online:21443/sdapi/v1/img2img"

def load_image_as_base64(image_path):
    with open(image_path, "rb") as img_file:
        return base64.b64encode(img_file.read()).decode("utf-8")

def inpaint_image(original_image_path, mask_image_path, prompt, output_path):
    # 加载原始图像和蒙版图像
    init_image_b64 = load_image_as_base64(original_image_path)
    mask_image_b64 = load_image_as_base64(mask_image_path)
    
    # 构建请求体
    payload = {
        "init_images": [f"data:image/png;base64,{init_image_b64}"],
        "mask": f"data:image/png;base64,{mask_image_b64}",
        "prompt": prompt,
        "steps": 50,  # 可根据需求调整
        "cfg_scale": 7.0,  # 可根据需求调整
        "sampler_index": "Euler",  # 可选择不同采样器
        "width": 512,  # 图像宽度
        "height": 512  # 图像高度
    }
    
    # 发送请求
    response = requests.post(API_URL, json=payload)
    
    if response.status_code == 200:
        # 解析响应
        result = response.json()
        # 获取生成的图像（base64 编码）
        generated_image_b64 = result['images'][0].split(",", 1)[1]
        # 解码并保存图像
        generated_image = Image.open(BytesIO(base64.b64decode(generated_image_b64)))
        generated_image.save(output_path)
        print(f"Inpainting 完成，结果已保存至 {output_path}")
    else:
        print(f"请求失败，状态码：{response.status_code}")
        print(response.text)

# 示例调用
original_image = "11.png"  # 原始图像路径
mask_image = "mask.png"        # 蒙版图像路径（白色区域为需要重绘部分）
prompt_text = "blue eyes"        # 提示词
output_image = "inpaint_result.png"          # 输出图像路径

inpaint_image(original_image, mask_image, prompt_text, output_image)
