import requests
import json
import base64
import io
from PIL import Image
import urllib3
import random
import numpy as np
import matplotlib.pyplot as plt
import os

# 禁用SSL警告（仅用于测试环境）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://sd.italkwithai.online:21443/sdapi/v1/txt2img"

# 使用一个固定的正整数作为 seed
fixed_seed = random.randint(1, 2147483647)  # 使用随机生成的正整数

payload = {
    "prompt": "a tiny cat",
    "negative_prompt": "nsfw",
    "steps": 30,
    "width": 512,
    "height": 512,
    "sampler_name": "Euler",
    "scheduler": "Simple",
    "cfg_scale": 1,
    "seed": -1,  # 使用固定的 seed
    "batch_size": 1,
    "model": "flux1-dev-bnb-nf4-v2.safetensors",
    "txt2img enable_hr": False

}

print(f"使用的 seed 值: {fixed_seed}")

try:
    response = requests.post(url, json=payload, verify=False, timeout=120)  # 添加超时设置
    response.raise_for_status()  # 如果响应状态码不是 200，将引发异常
except requests.exceptions.RequestException as e:
    print(f"请求失败: {e}")
    exit()

try:
    response_json = response.json()
except json.JSONDecodeError:
    print("无法解析JSON响应")
    print("原始响应内容:")
    print(response.text)
    exit()

# 检查响应是否包含预期的键
if 'images' not in response_json:
    print("响应中没有 'images' 键")
    print("完整的响应内容:")
    print(json.dumps(response_json, indent=2))
    exit()

# 获取图片数据
for i, img_data in enumerate(response_json['images']):
    print(f"\n处理图片 {i}:")
    
    # 检查 img_data 是否为有效的 base64 字符串
    if not isinstance(img_data, str) or not img_data.strip():
        print(f"图片 {i} 的数据无效")
        continue

    # 检查 base64 数据的前缀
    if img_data.startswith("data:image/"):
        print("Base64 数据包含正确的 MIME 类型前缀")
    else:
        print("警告：Base64 数据没有预期的 MIME 类型前缀")

    # 保存原始的 base64 数据
    with open(f"base64_data_{i}.txt", "w") as f:
        f.write(img_data)
    print(f"原始 base64 数据已保存为 base64_data_{i}.txt")

    # 尝试解码 base64 数据
    try:
        image_data = base64.b64decode(img_data)
    except base64.binascii.Error:
        print(f"图片 {i} 的 base64 数据无效")
        continue

    # 保存原始图片数据
    with open(f"raw_image_{i}.png", "wb") as f:
        f.write(image_data)
    print(f"原始图片数据已保存为 raw_image_{i}.png")

    # 尝试用 PIL 打开和保存
    try:
        image = Image.open(io.BytesIO(image_data))
        image.save(f"pil_image_{i}.png")
        print(f"PIL 处理后的图片已保存为 pil_image_{i}.png")
        print(f"图片大小: {image.size}")
        print(f"图片模式: {image.mode}")

        if image.mode == "RGB":
            img_array = np.array(image)
            print(f"图像形状: {img_array.shape}")
            print(f"数据类型: {img_array.dtype}")
            print(f"最小值: {img_array.min()}")
            print(f"最大值: {img_array.max()}")
            print(f"平均值: {img_array.mean():.2f}")
        else:
            print(f"图像模式不是 RGB，而是 {image.mode}")

        # 使用 matplotlib 显示和保存图像
        plt.figure(figsize=(10, 10))
        plt.imshow(image)
        plt.axis('off')
        plt.title("Generated Image")
        plt.savefig(f"matplotlib_image_{i}.png")
        print(f"Matplotlib 图像已保存为 matplotlib_image_{i}.png")

    except Exception as e:
        print(f"处理图片时出错: {str(e)}")

    # 打印文件大小信息
    print(f"raw_image_{i}.png 大小: {os.path.getsize(f'raw_image_{i}.png')} bytes")
    print(f"pil_image_{i}.png 大小: {os.path.getsize(f'pil_image_{i}.png')} bytes")
    print(f"matplotlib_image_{i}.png 大小: {os.path.getsize(f'matplotlib_image_{i}.png')} bytes")

print("\nAPI响应内容:")
print(json.dumps(response_json, indent=2))
