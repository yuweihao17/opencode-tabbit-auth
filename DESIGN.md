# Tabbit (AI 智能浏览器) Magpie 插件架构设计文档 (`DESIGN.md`)

## 一、项目背景与定位

[Tabbit](https://tabbit.com / https://tabbit.ai / https://web.tabbit.com) 是北京酷讯互动科技有限公司（Monica 母公司）推出的 AI 智能浏览器。Tabbit 为用户聚合了主流旗舰级大模型（包含 DeepSeek V4.1、GLM-5.3、Kimi K3、Qwen3.8-Max、MiMo 等），并向标准版及会员用户提供周期性免费额度。

本插件 `opencode-tabbit-auth` 为 [Magpie](https://usemagpie.ai) 与 OpenCode 体系提供官方级模型供应商接入，将 Tabbit 网页端会话转换为标准的 OpenAI 兼容 Chat Completions 接口，支持思考过程（Reasoning / Thinking）双向流式透传及额度卡片可视化监控。

---

## 二、端点拓扑与协议逆向分析

### 1. 核心网络端点

| 功能 | 方法 | 端点路径 | 鉴权方式 |
| :--- | :--- | :--- | :--- |
| **模型目录发现** | GET | `https://web.tabbit.com/proxy/v1/model_config/models?a=0&scene=chat` | Cookie + trace-id |
| **创建对话房间** | POST | `https://web.tabbit.com/api/v3/chat/rooms` | Cookie + trace-id |
| **提交对话运行** | POST | `https://web.tabbit.com/api/v3/chat/rooms/{roomId}/runs` | Cookie + trace-id |
| **加入事件流 (SSE)** | POST | `https://web.tabbit.com/api/v3/chat/rooms/{roomId}/join` | Cookie + trace-id |
| **流式备用通道** | GET | `https://web.tabbit.com/api/v2/chat/turns/{runId}/stream` | Cookie + trace-id |
| **用户基本信息** | GET | `https://web.tabbit.com/api/v0/user/base-info` | Cookie + trace-id |
| **额度池状态** | GET | `https://web.tabbit.com/api/commerce/quota/v1/pools?user_id={uid}&cycle_offset=0` | Cookie + trace-id |
| **额度周期详情** | GET | `https://web.tabbit.com/api/commerce/quota/v1/usage?user_id={uid}` | Cookie + trace-id |

### 2. 请求报头要求

Tabbit 网页端采用严格的安全与会话校验：
- `Cookie`: 会话 Cookie，支持粘贴包含会话认证令牌的整串 Cookie。
- `trace-id`: 客户端每次请求生成的随机 UUID（RFC 4122），防重放追踪。
- `Content-Type`: `application/json`。
- `Accept`: 接口请求为 `application/json`；流式拉取时为 `text/event-stream`。

---

## 三、流式事件转换流水线 (SSE Pipeline)

Tabbit 采用其私有的 Run & Turn 事件驱动架构，插件使用 Web Streams API (`TransformStream`) 在内存中对数据流执行零延迟双向转码：

```
[Tabbit SSE 服务端]
       │
       ▼ (原始 Chunk 事件)
   onThinking ──────────────► delta: { reasoning_content: "..." }
   onThinkingFinished ──────► (结束思考阶段)
   onMessageChunk ──────────► delta: { content: "..." }
   onMessageFinish ─────────► delta: {}, finish_reason: "stop"
   onRunFinish ─────────────► data: [DONE]
       │
       ▼ (标准 OpenAI 协议)
[Magpie / 客户端] (VS Code, Cursor, Claude Code, 手机端等)
```

---

## 四、额度体系与监控映射 (`auth.usage`)

Tabbit 网页端 `https://web.tabbit.com/member/usage` 展示周期性额度：
- **`total_cycle_quota`**：周期总额度（例如 3000 点）。
- **`used_quota`**：本周已使用点数。
- **`remain_quota`**：本周剩余点数。
- **`remaining_reset_hours`**：距离重置周期的剩余小时数。

插件将其精准归一化为 Magpie 的标准窗口格式：
```json
{
  "plan": "标准版",
  "signIn": "kept",
  "windows": [
    {
      "name": "周剩余用量",
      "used": 0,
      "amount": 0,
      "limit": 3000,
      "display": "100.0% (剩余 3000 点 · 2天20小时后重置)",
      "unit": "points"
    }
  ]
}
```

---

## 五、零依赖设计与测试验证

- 插件不依赖任何外部第三方 NPM 包，纯原生基于 Node.js / Bun 的标准 WebCrypto、TransformStream、Headers 与 fetch 规范编写。
- 自动化测试 `index.test.mjs` 基于 Node 原生测试运行器（`node --test`），全程离线 Mock 网络请求，确保环境无关与确定性输出。
