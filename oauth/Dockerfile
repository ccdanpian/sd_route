FROM python:3.9-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 使用环境变量设置端口
ENV AUTH_SERVICE_PORT=25002

# 暴露默认端口
EXPOSE ${AUTH_SERVICE_PORT}

CMD ["python", "api/auth_route.py"]
