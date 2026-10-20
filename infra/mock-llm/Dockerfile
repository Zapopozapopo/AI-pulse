FROM python:3.12-alpine
WORKDIR /app
COPY infra/mock-llm/mock-llm-server.py .
ENV PORT=4001 PYTHONUNBUFFERED=1
USER nobody
EXPOSE 4001
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:4001/health || exit 1
CMD ["python3", "mock-llm-server.py"]
