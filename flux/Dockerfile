FROM python:3.9-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 使用环境变量设置端口
ENV SD_ROUTE_PORT=25001

# 暴露默认端口（虽然实际端口由环境变量控制）
EXPOSE ${SD_ROUTE_PORT}

CMD ["python", "api/sd_route.py"]
