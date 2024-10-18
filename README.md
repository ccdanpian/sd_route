## 环境变量说明

### FLUX画图应用

| 变量名 | 描述 | 说明 |
|--------|------|------|
| `SD_ROUTE_PORT` | 应用服务端口 | FLUX画图应用的监听端口 |
| `SD_URL` | Stable Diffusion WebUI Forge的访问地址 | 用于连接到SD WebUI的URL |
| `SD_OUTPUT_DIR` | 图片输出目录 | 生成的图片保存的路径 |
| `OPENAI_API_KEY` | OpenAI API密钥 | 用于访问OpenAI服务的认证密钥 |
| `OPENAI_API_BASE` | OpenAI API基础URL | 自定义的OpenAI API端点 |
| `ENABLE_IP_RESTRICTION` | 是否启用IP限制 | 控制是否开启IP访问限制功能 |
| `CHATGPT_MODEL` | 使用的ChatGPT模型 | 指定使用的ChatGPT模型版本 |
| `CONTENT_REVIEW_PROMPT` | 内容审核提示 | 用于内容审核的ChatGPT提示词 |
| `MAX_QUEUE_SIZE` | 最大队列大小 | 限制同时处理的最大请求数 |
| `SD_MODEL` | 使用的Stable Diffusion模型 | 指定使用的SD模型文件名 |
| `AUTH_SERVICE_URL` | OAuth2服务API地址 | 认证服务的URL地址 |
| `LOG_LEVEL` | 日志级别 | 设置应用的日志详细程度 |
| `JWT_SECRET` | JWT密钥 | 用于JWT令牌加密的密钥 |
| `JWT_ALGORITHM` | JWT算法 | 指定JWT加密使用的算法 |

### OAuth2服务API

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
