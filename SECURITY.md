# Security Policy and Threat Model (SECURITY.md)

Freya is a local-first microkernel AI Agent system. This document defines the security boundaries and trust model of Freya, mitigating the risk of damages to the local host machine or internal networks caused by LLM prompt injection attacks.

---

## 1. Threat Model & Built-in Logical Sandboxes

> [!NOTE]
> **System Virtualization Notice**: To keep the codebase lightweight, the Freya monolithic microkernel runs directly within the host process by default. Official production-ready Docker images (`ghcr.io/eoasmxd/freya:latest`) are available, and **we strongly recommend using Docker container isolation for production and multi-tenant environments**.
> Meanwhile, to ensure autonomous agent safety across diverse environments, official built-in tools implement the following three layers of logical sandbox defense gateways:

*   **Workspace Sandbox**:
    The official filesystem plugin (`plugin-tool-fs`) enforces strict sandbox boundaries: **write operations (create, modify files) are strictly restricted** to the `~/.freya/workspace/` (or configured custom workspace) directory. **Read operations** default to the workspace, while supporting controlled whitelist read-only scopes (`src` source code, `doc` documentation) when explicitly configured. LLMs are **strictly prohibited** from using absolute paths or traversing relative paths (such as `../`) to access host sensitive files outside the workspace or permitted scopes.
*   **SSRF Guard**:
    The official web request plugin (`plugin-tool-web`) enforces hostname and IP address auditing before issuing HTTP/HTTPS requests. LLMs are **strictly prohibited** from accessing `localhost`, `127.0.0.1`, and private/internal network ranges (e.g., `192.168.x`, `10.x`, `172.x`), preventing unauthorized local port exploitation or internal network lateral movement.
*   **Config Write Shield**:
    Within the `UpdateConfigTool` gateway, the core engine hard-blocks modification requests targeting critical paths (such as the `workspace` directory) to prevent LLMs from tampering with sandbox boundaries via configuration APIs.

---

## 2. ⚠️ Critical Warning: Privilege Escalation via Third-Party Plugins

> [!WARNING]
> **Any untrusted third-party plugin can directly and completely bypass logical sandbox restrictions enforced by official plugins.**

*   **Root Cause**: Due to Freya's lightweight microkernel design, all loaded plugins run inside the **same Node.js host process** and share the **same operating system user permissions** as the core runtime. Multi-process hardware/OS-level isolation is not implemented.
*   **Bypass Vectors**: Untrusted third-party skill or tool plugins can directly import Node.js native system APIs (such as `node:child_process` for shell command execution, or `node:fs` for arbitrary filesystem I/O), **completely circumventing** the logical workspace and network sandboxes.
*   **Preventative Measures**:
    1.  **Strictly avoid** loading and executing any third-party plugins from unknown sources or without thorough manual code security audits.
    2.  **Deploy via Official Docker Images**: When running in production or testing untrusted third-party plugins, it is strongly recommended to use the official Docker image (`ghcr.io/eoasmxd/freya:latest`), mounting only necessary persistent data directories (e.g., `-v $(pwd)/freya-data:/data`) to achieve process-level and filesystem isolation from the host.

---

## 3. Secure Usage & Development Guidelines

1.  **Run in Trusted Local Environments Only**:
    Never expose the Freya WebSocket port (default `3000`) or Web UI directly to the public Internet without access protection.
2.  **Principle of Least Privilege**:
    **Never** run the Freya service process with administrative or superuser privileges (`root`, `sudo`, or `Administrator`).
3.  **Credential Protection**:
    Never hardcode API keys or secrets in plugin source code or Skill Markdown files. All credentials must be stored in configuration files under `config/` or injected via `.env` environment variables.

---

## 4. Reporting Vulnerabilities

If you discover a security vulnerability in the Freya core or official plugins, please report it via:

*   **Reporting Channel**: Please open a private security advisory/issue on GitHub.
*   To protect other users and developers, please do not disclose vulnerability details or exploit code in public issues or pull requests until a patch has been released.
