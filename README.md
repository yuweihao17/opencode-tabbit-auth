# opencode-tabbit-auth

[English](#english) | [简体中文](#简体中文)

---

<a name="简体中文"></a>
## 简体中文

适用于 [Magpie](https://usemagpie.ai) 与 [OpenCode](https://opencode.ai) 的 **Tabbit (AI 智能浏览器)** 模型接入插件。

[Tabbit](https://www.tabbit.ai / https://web.tabbit.com) 为用户提供了丰富的旗舰级 AI 大模型生态与每周免费/会员点数。通过本插件，你可以直接将 Tabbit 的全部模型接入 Magpie，在本地各种 Coding Agent（VS Code、Cursor、Claude Code、ZCode、Trae）以及手机端应用中统一调用！

### 🌟 特性

- **支持全量旗舰大模型**：DeepSeek-V4.1-Flash、GLM-5.3、Kimi-K3、Qwen3.8-Max、MiMo-V2.6-Pro、豆包 Seed-2.1-Pro、MiniMax-M3 等 20+ 款模型。
- **深度思考 (Reasoning) 原生流式支持**：完整还原 `onThinking` 思考过程与 `onMessageChunk` 答案流，支持 `reasoning_content`。
- **动态模型发现**：自动对接 Tabbit 云端模型接口，模型库更新时自动同步。
- **周用量与额度监控**：实时在 Magpie 额度面板中查看标准版/会员周剩余点数与重置倒计时。
- **跨平台通用**：基于纯标准 Web API 实现，不依赖任何第三方 npm 包，在 Windows 本地客户端与云端 Linux 服务器均可完美运行。

---

### 📦 安装方式

#### 1. 在本地电脑的 Magpie 客户端安装

打开命令行执行：

```bash
# 从本地项目目录添加
magpie plugin add D:\Projects\Tabbit
```

或者从 GitHub 安装：
```bash
magpie plugin add yuweihao17/opencode-tabbit-auth
```

#### 2. 在云服务器 / Web 端 Magpie 安装

在云服务器终端执行：
```bash
magpie plugin add yuweihao17/opencode-tabbit-auth
```

---

### 🔑 如何获取 Tabbit 登录 Cookie

1. 在浏览器（Chrome、Edge 或 Tabbit 浏览器）中打开并登录 [https://web.tabbit.com](https://web.tabbit.com)。
2. 按 `F12` 打开开发者工具，切换到 **控制台 (Console)**。
3. 输入以下命令并按回车：
   ```javascript
   copy(document.cookie)
   ```
   *(或者在 Application/应用 -> Cookies 中复制全部 Cookie 字符串)*。
4. 打开 Magpie，在 **【供应商】** 页面找到 **Tabbit**，点击 **【登录】**。
5. 将复制的 Cookie 粘贴到输入框中，点击确定即可完成连接！

---

### 📋 支持的模型列表

| 模型 ID | 模型说明 | 思考过程 (Reasoning) |
| :--- | :--- | :--- |
| `默认` | Tabbit 默认极速推理模型 (DeepSeek-V4-Flash) | ✅ |
| `DeepSeek-V4.1-Flash` | 深度求索最新多模态思考模型 (1M 上下文) | ✅ |
| `DeepSeek-V4-Flash` | 深度求索 Flash 模型 | ✅ |
| `DeepSeek-V4-Pro` | 深度求索旗舰 Pro 模型 | ✅ |
| `GLM-5.3` | 智谱旗舰编程与文本模型 (代码/安全 SOTA) | ✅ |
| `GLM-5.3-Flash` | 智谱旗舰多模态高速模型 | ✅ |
| `Kimi-K3` | 月之暗面最新超长上下文旗舰 (1M 上下文) | ✅ |
| `Kimi-K2.7-Code` | 月之暗面代码专家模型 | ✅ |
| `MiMo-V2.6-Pro` | 小米旗舰多模态思考模型 (1M 上下文) | ✅ |
| `MiMo-V2.6-Flash` | 小米高吞吐思考模型 (1M 上下文) | ✅ |
| `Qwen3.8-Max` | 阿里通义千问 2.4T 参数旗舰模型 | ✅ |
| `Qwen3.7-Max` | 阿里通义千问长文模型 | ✅ |
| `Doubao-Seed-2.1-Pro` | 字节跳动豆包旗舰 Pro 模型 | ✅ |
| `MiniMax-M3` | MiniMax 原生多模态模型 | ✅ |

---

### 🧪 运行单元测试

```bash
npm test
# 或
node --test
```
全部 18 项单元测试覆盖率达 100%。

---

<a name="english"></a>
## English

A [Magpie](https://usemagpie.ai) / [OpenCode](https://opencode.ai) provider plugin for **Tabbit (AI Browser)** models.

It bridges Tabbit's chat runs into OpenAI-compatible Chat Completions with real-time SSE streaming, thinking/reasoning delta forwarding, dynamic model discovery, and weekly quota visualization.

### 🌟 Features

- **20+ Leading Models**: Full access to DeepSeek-V4.1, GLM-5.3, Kimi-K3, Qwen3.8-Max, MiMo-V2.6-Pro, etc.
- **Native Reasoning Streaming**: Seamlessly maps `onThinking` and `onMessageChunk` to OpenAI chunks.
- **Zero Runtime Dependencies**: Pure Node.js / WebCrypto standard library.
- **Weekly Quota Tracking**: Visualizes standard/pro quota balance and reset schedule in Magpie.

### 📦 Installation

```bash
magpie plugin add D:\Projects\Tabbit
```

## License

MIT
