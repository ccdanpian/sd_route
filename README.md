# FLUX画图应用 & OAuth2服务

## 简介

本项目包含两个主要服务：

1. **FLUX画图应用**
   - 包括前端网页和后端中转路由
   - 需要登录使用，通过始皇LINUXDO网站的OAuth2服务进行认证
   - 使用Stable Diffusion WebUI Forge作为FLUX绘图的API
   - 启动命令：`python sd_route.py`
   - 访问地址：`http://localhost:sd_route_port/`

2. **OAuth2服务API**
   - 处理OAuth2认证流程
   - 包含LINUXDO的各项参数配置
   - 启动命令：`python auth_service.py`

## FLUX画图应用

### 配置说明

#### 环境变量

| 变量名 | 描述 | 说明 |
|--------|------|------|
| `SD_ROUTE_PORT` | 应用服务端口 | FLUX画图应用的监听端口 |
| `SD_URL` | Stable Diffusion WebUI Forge的访问地址 | 用于连接到SD WebUI的URL |
| `SD_OUTPUT_DIR` | 图片输出目录 | 生成的图片保存的路径 |
| `OPENAI_API_KEY` | OpenAI API密钥 | 用于访问OpenAI服务的认证密钥 |
| `OPENAI_API_BASE` | OpenAI API基础URL | 自定义的OpenAI API端点 |
| `ENABLE_IP_RESTRICTION` | 是否启用IP限制 | 控制是否开启IP访问限制功能 |
| `CHATGPT_MODEL` | 使用的ChatGPT模型 | 指定使用的ChatGPT模型版本 |
| `MAX_QUEUE_SIZE` | 最大队列大小 | 限制同时处理的最大请求数 |
| `AUTH_SERVICE_URL` | OAuth2服务API地址 | 认证服务的URL地址 |
| `LOG_LEVEL` | 日志级别 | 设置应用的日志详细程度 |
| `JWT_SECRET` | JWT密钥 | 用于JWT令牌加密的密钥 |
| `JWT_ALGORITHM` | JWT算法 | 指定JWT加密使用的算法 |

#### config.json 配置

`api/config.json` 文件包含了FLUX画图应用的额外配置，详细说明如下：

| 配置项 | 类型 | 描述 | 说明 |
|--------|------|------|------|
| `content_review_prompt` | 字符串 | 内容审核提示词 | 用于指导AI进行内容审核的提示词 |
| `content_translation_prompt` | 字符串 | 内容翻译提示词 | 用于指导AI进行内容翻译的提示词 |
| `sd_model` | 字符串 | Stable Diffusion模型 | 指定使用的SD模型文件名 |
| `sd_lora_models` | 数组 | LoRA模型配置列表 | 包含多个LoRA模型的详细配置 |

`sd_lora_models` 数组中每个对象的结构如下：

| 字段 | 类型 | 描述 |
|------|------|------|
| `value` | 字符串 | LoRA模型的唯一标识符 |
| `name` | 字符串 | LoRA模型的显示名称 |
| `weight` | 数字 | LoRA模型的权重 |
| `url` | 字符串 | LoRA模型的相关URL |
| `triggerWords` | 字符串或数组 | 触发该LoRA模型的关键词 |
| `examplePic` | 字符串 | 示例图片的URL（可选） |

### 安装和使用

1. 克隆仓库
2. 设置环境变量（参考 `.env.template` 文件中的FLUX画图应用部分）
3. 配置 `api/config.json`
4. 安装依赖（如果有requirements.txt）
5. 启动应用：`python sd_route.py`

### 注意事项

- 确保正确配置了所有必要的环境变量和 `api/config.json` 文件
- 使用前请确保Stable Diffusion WebUI Forge已正确配置并运行
- 需要登录才能使用，请确保OAuth2服务API已启动

## OAuth2服务API

### 配置说明

#### 环境变量

| 变量名 | 描述 | 说明 |
|--------|------|------|
| `AUTH_SERVICE_PORT` | OAuth2服务API端口 | 认证服务的监听端口 |
| `OAUTH_CLIENT_ID` | OAuth客户端ID | LINUXDO提供的OAuth客户端标识 |
| `OAUTH_CLIENT_SECRET` | OAuth客户端密钥 | LINUXDO提供的OAuth客户端密钥 |
| `OAUTH_REDIRECT_URI` | OAuth重定向URI | 认证成功后的回调地址 |
| `OAUTH_AUTHORIZATION_ENDPOINT` | OAuth授权端点 | LINUXDO的OAuth授权URL |
| `OAUTH_TOKEN_ENDPOINT` | OAuth令牌端点 | LINUXDO的OAuth令牌获取URL |
| `OAUTH_USER_ENDPOINT` | OAuth用户信息端点 | LINUXDO的用户信息获取URL |
| `PROGRAM_SERVICE_URL` | X画图应用地址 | FLUX画图应用的访问地址 |

### 安装和使用

1. 克隆仓库（如果还未克隆）
2. 设置环境变量（参考 `.env.template` 文件中的OAuth2服务API部分）
3. 安装依赖（如果有requirements.txt且未安装）
4. 启动服务：`python auth_service.py`

### 注意事项

- 确保正确配置了所有必要的环境变量
- 需要在FLUX画图应用之前启动
