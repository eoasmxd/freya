---
title: "Installation, Build & Operations"
weight: 20
description: "A comprehensive guide on environment setup, NPM global install, Docker containerization, Home Assistant Add-on deployment, and building from source."
---

# Freya Installation, Build & Operations

## 1. Prerequisites

The following environment tools are required to run the project:
- **Node.js**: >= 22.0.0
- **pnpm** (required only for building from source): 9.x

---

## 2. Method 1: Global Install & Maintenance via NPM (Recommended)

Ideal for users looking to quickly deploy and run Freya out of the box. Published as a globally executable CLI tool, Freya can be launched immediately without downloading source code.

### 2.1 Global Installation
Run in your terminal:
```bash
npm install -g @eoasmxd/freya
```

### 2.2 Starting the Service
Choose a runtime mode based on your needs:
* **Foreground Standard Mode** (launches both Web interface and local interactive CLI):
  ```bash
  freya
  ```
* **Background Silent Mode** (disables local console, ideal for server deployments; the parent process safely detaches back to the terminal):
  ```bash
  freya --no-cli
  ```

### 2.3 Stopping the Service
When you need to terminate the background Freya service, run:
```bash
freya stop
```

### 2.4 Manual Version Upgrades
When a new package version is published, perform these three steps to upgrade:
1. **Stop the background process**: `freya stop`
2. **Download and update the global package**: `npm install -g @eoasmxd/freya@latest`
3. **Relaunch the service** (foreground or background as needed): `freya` or `freya --no-cli`

---

## 3. Method 2: Containerized Deployment via Docker (Recommended)

Ideal for users who want zero Node.js environment configuration, out-of-the-box convenience, or lightweight private deployments on cloud servers/NAS devices.

### 3.1 Run Service with Persistent Storage
Run the following command to pull the latest official image and start as a daemon (maps Web service to port 3000 and mounts the host `./freya-data` directory into the container persistence directory):

```bash
docker run -d \
  --name freya \
  -p 3000:3000 \
  -v $(pwd)/freya-data:/data \
  --restart unless-stopped \
  ghcr.io/eoasmxd/freya:latest
```

*Alternatively, build and run directly from local source:*
```bash
docker build -t freya .
docker run -d --name freya -p 3000:3000 -v $(pwd)/freya-data:/data freya
```

### 3.2 Stopping & Restarting the Service
* **Temporarily Stop**: `docker stop freya`
* **Resume**: `docker start freya`
* **Restart**: `docker restart freya`

### 3.3 Seamless Container Upgrades
When a new image version is published, follow these three steps for a zero-loss upgrade:
1. **Pull the latest image**: `docker pull ghcr.io/eoasmxd/freya:latest`
2. **Remove the old container**: `docker rm -f freya` (configurations and conversation memories are preserved in the `./freya-data` mount, ensuring data safety)
3. **Relaunch the service**: Re-run the `docker run` command from step 3.1.

---

## 4. Method 3: Deploy via Home Assistant Add-on (Smart Home Integration)

Ideal for users running Home Assistant (HAOS / Supervised) environments who want seamless whole-home smart automation powered by Freya.

> [!TIP]
> **Native Home Assistant Deep Integration**
> Running as a standard Home Assistant Add-on, Freya includes a dedicated smart home toolset that communicates directly with the Supervisor API for entity state perception and automated device control.

### 4.1 Installing the Add-on Repository

#### Method A: One-Click Automatic Addition (Recommended)
Click the button below to jump directly to your Home Assistant instance and add the repository:

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feoasmxd%2Fha-addons)

#### Method B: Manual Addition
1. Enter your Home Assistant dashboard.
2. Navigate to: **Settings** -> **Add-ons** -> **Add-on Store**.
3. Click the **three dots (⋮)** in the top right corner and select **Repositories**.
4. In the repository URL input box, enter:
   ```text
   https://github.com/eoasmxd/ha-addons
   ```
5. Click **Add**, close the modal, and refresh the store page. You will see **eoasMXD** and **Freya** under the add-on list.

### 4.2 Installation & Startup
1. Click **Freya** in the Add-on Store to enter the details page and click **Install**.
2. Once installed, we recommend enabling:
   - **Show in sidebar**: Easily access the Freya Web chat interface from the HA left navigation menu.
   - **Start on boot**: Ensure Freya launches automatically when Home Assistant reboots.
   - **Watchdog**: Automatically restart and guard the service in case of unexpected errors.
3. Click **Start** to begin using the service.

### 4.3 HA Interaction & Security Configuration
Freya's interaction with Home Assistant follows a Security by Default strategy:

* **Entity State Perception Authorization**:
  The devices and sensor entities Freya can observe are strictly limited to the entities exposed to Assist in the native Home Assistant interface (**Settings -> Voice assistants -> Expose**), preventing unauthorized entity data leaks.
* **Device Control Permissions Switch**:
  The application starts in **safe read-only mode** by default (querying entity states only). To allow the agent to execute actions such as switching lights or toggling appliances based on conversation requests, navigate to the Freya Web UI (**Settings -> Plugins -> Home Assistant Plugin Configuration**) and set `homeassistant.allowControl` to `true` (takes effect dynamically without restarting).

### 4.4 Data Persistence & Backup
All application configurations and conversation memories are persistently stored on the Home Assistant host under `/config/freya/`:
- **Data & Conversation Memories**: `/config/freya/data/`
- **User Configurations**: `/config/freya/config/`

Rebooting or upgrading the Add-on will never cause data loss. You can view or export backups directly via the native HA Backup feature or the File Editor / VS Code add-ons.

### 4.5 Upgrading the Add-on
When upstream releases a new version, an update notification will automatically appear in the Home Assistant Add-on Store. Click **Update** to upgrade smoothly in one click without running scripts or rebuilding containers.

---

## 5. Method 4: Build & Run from Source (Development Mode)

Ideal for developers who want to perform secondary development, build custom plugins, or deeply study the Freya microkernel architecture.

### 5.1 Installing Dependencies
After cloning the repository, install all workspace dependencies in the root directory:
```bash
pnpm install
```

### 5.2 Building & Packaging
Execute code compilation and physical package distribution aggregation:
```bash
pnpm build
```
*This command compiles core/sdk/ui and all plugins, generating the final distribution bundle in the `dist/` directory.*

### 5.3 Starting the Service
Select a launch mode based on your development and testing requirements:
* **Foreground Development Mode** (with interactive CLI terminal):
  ```bash
  pnpm freya
  ```
* **Background Daemon Mode** (silently runs the Web core, freeing the console):
  ```bash
  pnpm freya --no-cli
  ```

### 5.4 Stopping the Service
To terminate resident background child processes, run from the root directory:
```bash
pnpm stop
```

### 5.5 Updating & Synchronizing Code
When pulling the latest commits from the code repository, run in the root directory:
1. **Stop background processes**: `pnpm stop`
2. **Pull latest source code**: `git pull origin main`
3. **Rebuild packages**: `pnpm install && pnpm build`
4. **Relaunch the service** (foreground or background as needed): `pnpm freya` or `pnpm freya --no-cli`
