# ASCILINE live server — Python + ffmpeg, no host dependency install needed.
FROM python:3.11-slim

WORKDIR /app

# ffmpeg/ffprobe for audio + thumbnails; ca-certificates for yt-dlp HTTPS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Container has no display — headless OpenCV is the lighter drop-in (see README).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y opencv-python || true \
    && pip install --no-cache-dir opencv-python-headless

COPY . .

# Default playback folder; mount host videos here via compose.
RUN mkdir -p videos

EXPOSE 8000

# Must bind 0.0.0.0 so port mapping reaches the host browser.
# --folder videos: drop files into the mounted ./videos directory.
CMD ["python", "stream_server.py", "--folder", "videos", "--host", "0.0.0.0", "--port", "8000"]
