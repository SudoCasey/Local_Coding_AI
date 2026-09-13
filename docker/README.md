# Docker & GPU Setup Guide for Local Coding AI

This guide explains how to run the local inference engine using Docker with full NVIDIA RTX 3080 GPU acceleration under Windows 10 and WSL2.

---

## 1. Prerequisites (Windows 10 + WSL2 + RTX 3080)

1. **NVIDIA Driver**: Ensure you have modern Game Ready or Studio Drivers installed on Windows 10 (version 535+). WSL2 automatically accesses the GPU via the Windows driver.
2. **WSL2**: Ensure WSL2 is updated:
   ```powershell
   wsl --update
   ```
3. **Docker Desktop for Windows**:
   - In Docker Desktop Settings -> **General**, enable **Use the WSL 2 based engine**.
   - In Settings -> **Resources -> WSL Integration**, enable integration with your default WSL distro (e.g. `Ubuntu`).

---

## 2. Quick Start (Running Ollama via Docker)

Navigate to the `docker/` folder and launch the stack:

```bash
cd docker
docker compose up -d
```

### Checking Container Status & GPU Acceleration:
```bash
# Check if container is running and healthy
docker compose ps

# Verify GPU is detected inside container
docker exec -it local-coding-ai-ollama nvidia-smi
```

You will see your **NVIDIA GeForce RTX 3080 (12GB VRAM)** listed with CUDA support.

---

## 3. Pulling Initial Coding Models

Once the container is running, pull the recommended models:

```bash
# Primary Coding Model (~5.5GB VRAM, fits RTX 3080 with 16K-32K context)
docker exec -it local-coding-ai-ollama ollama pull qwen2.5-coder:7b

# Fast Routing & Compaction Model (~1.5GB VRAM)
docker exec -it local-coding-ai-ollama ollama pull qwen2.5-coder:1.5b

# (Optional) Heavy Architectural Model (~9GB VRAM Q4_K_M)
docker exec -it local-coding-ai-ollama ollama pull qwen2.5-coder:14b
```

Alternatively, you can pull models directly inside VS Code by clicking the **"+"** button in the Local Coding AI sidebar!

---

## 4. Completely Offline Operation

- All model weights are stored in the persistent Docker volume `local_coding_ai_models` on your local SSD (`/root/.ollama`).
- Once downloaded, the container and VS Code extension require **zero internet access**.
- You can disconnect your network adapter or work in an air-gapped environment; the assistant runs 100% locally.

---

## 5. Native Windows Option (Alternative to Docker)

If you prefer not to use Docker during development, you can simply run native Ollama for Windows:
1. Download from [ollama.com](https://ollama.com/download/windows).
2. Run `ollama serve` or let the Windows tray app run.
3. The VS Code extension connects to `http://127.0.0.1:11434` identically for both Native and Docker setups.
