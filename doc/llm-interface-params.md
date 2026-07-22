# Freya LLM 插件调用接口与参数规范

本篇文档旨在定义 Freya 统一的大模型（LLM）插件调用接口以及生成参数（`modelParams`）规范，以便开发者在扩展或实现新的 LLM 插件时有所遵循。

---

## 1. 核心接口

所有大模型插件（如 `plugin-gemini`、`plugin-openai` 等）都通过 `llm-proxy` 统一分发并暴露标准的接口方法：

```typescript
async chat(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  options?: LLMOptions
): Promise<{
  message: LLMMessage;
  usage?: LLMTokenUsage;
}>;
```

---

## 2. 统一生成参数规范 (`modelParams`)

为了屏蔽不同大模型服务商在参数命名上的差异（如 `max_tokens` 与 `maxOutputTokens`），Freya 规定了一套**驼峰命名（CamelCase）**的通用生成参数标准。

在调用 `llm.chat` 时，应通过 `options.modelParams` 传递这些参数。各插件仅负责从其中提取支持的驼峰属性，并准确转换为服务商 API 要求的格式。

### 统一参数字段一览

| 参数字段名 | 类型 | 说明 | Gemini 映射关系 | OpenAI 映射关系 |
| :--- | :--- | :--- | :--- | :--- |
| **`temperature`** | `number` | 采样温度系数（一般 0.0 ~ 2.0）。值越高生成内容越随机。 | `temperature` | `temperature` |
| **`maxTokens`** | `number` | 限制单次回复的最大 Token 额度。 | `maxOutputTokens` | `max_tokens` |
| **`topP`** | `number` | 核采样概率（0.0 ~ 1.0）。 | `topP` | `top_p` |
| **`topK`** | `number` | 候选词采样数量。从前 K 个最可能的候选词中采样。 | `topK` | *(不适用)* |
| **`stopSequences`** | `string[]` | 停止生成序列。当生成文本中出现这些序列之一时自动中断。 | `stopSequences` | `stop` |
| **`presencePenalty`** | `number` | 存在惩罚系数（-2.0 ~ 2.0）。鼓励模型讨论新话题。 | `presencePenalty` | `presence_penalty` |
| **`frequencyPenalty`** | `number` | 频率惩罚系数（-2.0 ~ 2.0）。惩罚模型重复词汇。 | `frequencyPenalty` | `frequency_penalty` |
| **`responseFormat`** | `object` | 约束输出格式。可设为 `{ type: 'json_object', jsonSchema?: Record<string, any> }`。 | `responseMimeType: "application/json"`, 支持 schema | `response_format` |
| **`seed`** | `number` | 随机数种子，有利于保障生成的幂等性。 | *(不适用)* | `seed` |
| **`timeout`** | `number` | 单次请求的超时时长（单位：毫秒），默认 90000。 | 控制 fetch 请求超时 | 控制 fetch 请求超时 |

---

## 3. 安全过滤机制

### 核心元数据剥离
在核心的代理分发层（`llm-proxy.ts`）合并模型预设配置时，以下非生成参数的**模型配置元数据字段**会被统一剥离和剔除，以绝后患地防止非参数字段写入 `modelParams` 进而导致部分厂商 API 报 400（Invalid Payload）错：
- `id`
- `name`
- `inputPrice`
- `outputPrice`
- `cachedInputPrice`
- `contextWindow`
- `contextTokens`
- `capabilities`

### 插件层白名单提取
所有官方插件**不应采用 `...extraParams` 的透传方式**。插件的实现应当仅提取以上表格里声明的、支持的白名单生成参数。任何未定义的自定义参数将不会传往厂商 API 根节点。

---

## 4. 插件实现示范

当您实现一个新的大模型插件时，对 `modelParams` 的提取应参照如下模式（以 Gemini 为例）：

```typescript
const params = options?.modelParams || {};
const generationConfig: Record<string, any> = {};

if (typeof params.temperature === 'number') {
  generationConfig.temperature = params.temperature;
}
if (typeof params.maxTokens === 'number' && params.maxTokens > 0) {
  generationConfig.maxOutputTokens = params.maxTokens;
}
// 仅提取映射需要的参数...
```

---

## 4. 大模型消息结构与属性规范 (`LLMMessage`)

Freya 内核通过统一的 `LLMMessage` 对象来表示对话历史中的每一个消息节点。为了兼容和抽象不同大模型服务商在多轮工具调用（Function Calling）以及推理校验上的核心流派差异，`LLMMessage` 中的主要属性字段定义及职责如下：

### 4.1 基础属性
*   **`role`** (`'user' | 'assistant' | 'system' | 'tool'`)：消息在对话中的角色。
    *   *映射规范*：对于不支持显式 `'tool'` 角色的厂商 API（如 Gemini REST 接口），插件层应当在转换对话历史时将其统一映射为 `"user"` 以符合接口的协议规范。
*   **`content`** (`string`)：消息的文本正文。
*   **`attachments`** (`ChannelAttachment[]`)：消息附带的多模态附件（如图像等）。

### 4.2 工具调用关联属性（基于 ID 关联流派）
主要服务于以 OpenAI 协议为代表、在多轮工具调用中通过特定的**唯一 ID** 关联工具调用与工具执行结果的流派：
*   **`toolCalls`** (`LLMToolCall[]`)：大模型在 `'assistant'` 消息中输出的工具调用指令列表。每个 `LLMToolCall` 包含 `id`、`name`（工具名）与 `arguments`（参数）。
*   **`toolCallId`** (`string`)：在 `'tool'` 角色的消息中，用来指定该条工具执行结果所对应的工具调用 `id`。

### 4.3 推理校验与工具原名属性（基于名称与签名校验流派）
主要服务于以 Gemini 协议为代表、在多轮工具调用中通过**工具名称**关联响应，且必须回传推理状态签名的流派：
*   **`thoughtSignature`** (`string`)：由支持 stateless 思考（Reasoning）的模型在响应中输出的加密思考签名。
    *   *插件职责*：解析响应时，将模型返回的签名捕获并挂载在 `message.thoughtSignature` 根属性上；回传历史消息时，按照厂商 API 规定的结构（如 Gemini 要求其作为同级属性嵌套在对应的 `functionCall` Part 元素中并列发送）回传。
    *   *内核职责*：核心层对该签名保持不透明（Opaque）传输，仅负责随历史消息无损序列化落盘与加载还原。
*   **`toolName`** (`string`)：在 `'tool'` 角色的消息中，用来随路保存和持久化该条工具响应所对应的工具原名称。
    *   *插件职责*：在还原工具响应历史（`role: 'tool'` 消息）到大模型 payload 时，优先读取该属性；其次在前序历史消息中向上回溯相同 ID 的工具调用以恢复其名称，确保生成的 `functionResponse.name` 绝对与上一轮大模型调用的 `functionCall.name` 保持一致。
