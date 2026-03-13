# AppName: f1-live-pulse-worker

FROM python:3.9-slim

WORKDIR /app

# Závislosti
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Aplikace
COPY worker.py .

# Spouštěcí příkaz (musíme nastavit worker tak, aby se restartoval, nebo použít bash skript na nekonečnou smyčku pro MVP demo)
CMD ["python", "-u", "worker.py"]
