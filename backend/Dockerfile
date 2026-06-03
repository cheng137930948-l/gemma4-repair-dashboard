# Gemma 4 维修看板 · 后端镜像（Flask + google-genai 原生函数调用循环）
FROM python:3.12-slim

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 再拷贝源码（.dockerignore 已排除 .env / .venv / output 等，密钥不会进镜像）
COPY . .

# 默认配置；端口用 8001（规避常见的 8000 占用）。GOOGLE_API_KEY 运行时注入，绝不写进镜像。
ENV PORT=8001 \
    MODEL_NAME=gemma-4-26b-a4b-it \
    CALL_TIMEOUT_MS=120000 \
    RUN_BUDGET_SEC=150 \
    REPLAY_ONLY=0
EXPOSE 8001

# report_server.py 会从环境变量读取 PORT / GOOGLE_API_KEY 等
CMD ["python", "report_server.py"]
