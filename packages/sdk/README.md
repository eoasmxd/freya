# @eoasmxd/freya-sdk

Freya 智能体系统的官方插件开发标准 SDK。本项目定义了 Freya 的核心扩展契约、插件生命周期接口及公共类型。

## 安装

如果你想开发第三方 Freya 插件，请在你的项目中引入本 SDK 作为开发依赖：

```bash
npm install @eoasmxd/freya-sdk --save-dev
```

## 核心契约

本 SDK 导出了以下关键契约和接口：

* `FreyaPlugin`：标准插件基类契约。
* `LLMPlugin`：大语言模型提供商插件标准接口。
* `ToolPlugin`：扩展工具（Tool）插件标准接口。

## 快速上手

下面是一个简单的工具插件模版：

```typescript
import { ToolPlugin, FreyaContext } from '@eoasmxd/freya-sdk';

export class MyCustomTool implements ToolPlugin {
  type = 'tool';

  getId(): string {
    return 'my-custom-tool';
  }

  async execute(context: FreyaContext, params: any): Promise<any> {
    // 插件业务逻辑
    return { result: 'Hello from custom tool!' };
  }
}
```

## 开源协议

基于 [MIT License](LICENSE) 协议开源。
