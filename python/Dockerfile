FROM python:3.12-alpine

# Install git and system tools
RUN apk add --no-cache git openssh-client ca-certificates tzdata gcc musl-dev linux-headers

# Avoid Git dubious ownership errors in mounted volumes
RUN git config --system --add safe.directory "*"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot.py .

RUN mkdir -p /app/repo

ENV REPO_DIR=/app/repo

CMD ["python", "bot.py"]
