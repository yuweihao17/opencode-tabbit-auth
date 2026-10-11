// Tabbit (AI 智能浏览器 / 酷讯互联) as a Magpie / OpenCode provider plugin.
//
// Tabbit (https://tabbit.com / https://tabbit.ai / https://web.tabbit.com)
// integrates multiple flagship AI models (DeepSeek-V4.1-Flash, GLM-5.3, Kimi-K3,
// Qwen3.8-Max, MiMo-V2.6-Pro, etc.) with weekly free and membership quotas.
// This plugin enables Magpie to discover and call Tabbit's models via standard
// OpenAI-compatible Chat Completions, with full reasoning/thinking and quota streaming.

import { randomUUID } from "node:crypto"

const PROVIDER = "tabbit"
const NPM = "@ai-sdk/openai-compatible"
const SESSION_API_KEY = "tabbit-session"
const DEFAULT_API_BASE = "https://web.tabbit.com"

// Fallback catalog of known models available on Tabbit
const CATALOG = [
  { id: "默认", name: "Tabbit 默认 (DeepSeek-V4-Flash)", context: 1000000, reasoning: true },
  { id: "DeepSeek-V4.1-Flash", name: "DeepSeek-V4.1-Flash", context: 1000000, reasoning: true },
  { id: "DeepSeek-V4-Flash", name: "DeepSeek-V4-Flash", context: 1000000, reasoning: true },
  { id: "DeepSeek-V4-Pro", name: "DeepSeek-V4-Pro", context: 1000000, reasoning: true },
  { id: "GLM-5.3", name: "GLM-5.3", context: 1000000, reasoning: true },
  { id: "GLM-5.3-Flash", name: "GLM-5.3-Flash", context: 1000000, reasoning: true },
  { id: "GLM-5.3-FlashX", name: "GLM-5.3-FlashX", context: 1000000, reasoning: true },
  { id: "GLM-5.2", name: "GLM-5.2", context: 1000000, reasoning: true },
  { id: "GLM-5.1", name: "GLM-5.1", context: 1000000, reasoning: true },
  { id: "Kimi-K3", name: "Kimi-K3", context: 1000000, reasoning: true },
  { id: "Kimi-K2.7-Code", name: "Kimi-K2.7-Code", context: 1000000, reasoning: true },
  { id: "Kimi-K2.6", name: "Kimi-K2.6", context: 1000000, reasoning: true },
  { id: "MiMo-V2.6-Pro", name: "MiMo-V2.6-Pro", context: 1000000, reasoning: true },
  { id: "MiMo-V2.6-Flash", name: "MiMo-V2.6-Flash", context: 1000000, reasoning: true },
  { id: "Qwen3.8-Max", name: "Qwen3.8-Max", context: 1000000, reasoning: true },
  { id: "Qwen3.7-Max", name: "Qwen3.7-Max", context: 1000000, reasoning: true },
  { id: "Qwen3.5-Plus", name: "Qwen3.5-Plus", context: 1000000, reasoning: false },
  { id: "Doubao-Seed-2.1-Pro", name: "Doubao-Seed-2.1-Pro", context: 1000000, reasoning: true },
  { id: "Doubao-Seed-2.1-Turbo", name: "Doubao-Seed-2.1-Turbo", context: 1000000, reasoning: true },
  { id: "MiniMax-M3", name: "MiniMax-M3", context: 1000000, reasoning: true },
  { id: "LongCat-2.0", name: "LongCat-2.0", context: 1000000, reasoning: true },
]

// ---- Helpers ---------------------------------------------------------------

function safeJson(text) {
  if (typeof text !== "string") return null
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function cleanCookie(raw) {
  if (typeof raw !== "string") return ""
  return raw
    .trim()
    .replace(/^Cookie:\s*/i, "")
    .replace(/[\r\n]+/g, "; ")
    .trim()
}

function extractUserId(cookieStr, explicitUserId) {
  if (explicitUserId && typeof explicitUserId === "string" && explicitUserId.trim()) {
    return explicitUserId.trim()
  }
  if (!cookieStr) return ""
  // Try extracting from user_id or userId cookie if present
  const m = cookieStr.match(/(?:^|;\s*)(?:user_id|userId)=([^;]+)/i)
  if (m) return decodeURIComponent(m[1].trim())
  return ""
}

function normalizeModel(item) {
  const id = item.model_name || item.id || item.name || ""
  if (!id) return null
  const name = item.display_name || item.name || id
  const reasoning = item.thinking === true || Boolean(item.is_reasoning) || Boolean(item.is_support_deep_thinking)
  return {
    id,
    name,
    limit: { context: 1000000, output: 0 },
    reasoning,
    tool_call: true,
  }
}

/**
 * Maps Tabbit's `/proxy/v1/model_config/models` API response to a normalized models map.
 */
function parseRemoteModels(json) {
  const models = {}
  const list = Array.isArray(json?.models) ? json.models : Array.isArray(json?.data) ? json.data : []
  for (const item of list) {
    const m = normalizeModel(item)
    if (m) models[m.id] = m
  }
  return models
}

/**
 * Builds standard request headers for Tabbit web API.
 */
function buildTabbitHeaders(cookie, traceId = randomUUID()) {
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "trace-id": traceId,
  }
  if (cookie) {
    headers["Cookie"] = cleanCookie(cookie)
  }
  return headers
}

/**
 * Formats multi-turn chat messages into Tabbit input content and reference history.
 */
function formatChatInput(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { content: "", history: [] }
  }

  // Combine system prompt and user messages if needed
  let systemText = ""
  const turns = []

  for (const msg of messages) {
    const role = msg.role || "user"
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")
    if (role === "system") {
      systemText = systemText ? `${systemText}\n\n${content}` : content
    } else {
      turns.push({ role, content })
    }
  }

  if (turns.length === 0) {
    return { content: systemText, history: [] }
  }

  // The last turn is the active prompt
  const lastTurn = turns[turns.length - 1]
  let activeContent = lastTurn.content

  if (systemText && turns.length === 1) {
    activeContent = `${systemText}\n\n${activeContent}`
  }

  return {
    content: activeContent,
    history: turns.slice(0, -1),
  }
}

/**
 * Translates an incoming OpenAI Chat Completions payload into Tabbit's v3 run payload.
 */
function buildTabbitRunPayload(openaiBody, clientRunId = randomUUID(), clientMessageId = randomUUID()) {
  const model = openaiBody.model || "默认"
  const { content } = formatChatInput(openaiBody.messages)

  return {
    client_run_id: clientRunId,
    client_message_id: clientMessageId,
    agent_plan_mode_enabled: false,
    input_payload: {
      task_name: "chat",
      content,
      parent_message_id: null,
      selected_model: model,
      references: [],
      metadatas: {},
      page_info_list: [],
      is_mobile: false,
      agent_mode: false,
    },
  }
}

/**
 * Maps Tabbit's SSE stream frames into standard OpenAI Chat Completion chunks.
 */
function createOpenAIStreamTransform(modelId, id = `chatcmpl-${randomUUID()}`) {
  const created = Math.floor(Date.now() / 1000)
  const encoder = new TextEncoder()
  let buffer = ""

  return new TransformStream({
    transform(chunk, controller) {
      buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""

      let currentEvent = ""

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          const rawData = line.slice(5).trim()
          if (!rawData || rawData === "[DONE]") continue
          const data = safeJson(rawData)
          if (!data) continue

          // 1. Thinking / reasoning chunk
          if (currentEvent === "onThinking" && typeof data.reasoning_content === "string") {
            const chunkPayload = {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: data.reasoning_content },
                  finish_reason: null,
                },
              ],
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`))
          }

          // 2. Normal text output chunk
          if (currentEvent === "onMessageChunk" && typeof data.content === "string") {
            const chunkPayload = {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: { content: data.content },
                  finish_reason: null,
                },
              ],
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`))
          }

          // 3. Finished message / run
          if (currentEvent === "onRunFinish" || currentEvent === "onMessageFinish") {
            const finishPayload = {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishPayload)}\n\n`))
          }
        }
      }
    },
    flush(controller) {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
    },
  })
}

/**
 * Aggregates SSE chunks into a complete non-streaming OpenAI chat completion JSON.
 */
async function aggregateStreamToCompletion(stream, modelId, id = `chatcmpl-${randomUUID()}`) {
  const reader = stream.getReader()
  let fullContent = ""
  let fullReasoning = ""
  let buffer = ""
  const decoder = new TextDecoder()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += typeof value === "string" ? value : decoder.decode(value)
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    let currentEvent = ""

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        const rawData = line.slice(5).trim()
        if (!rawData) continue
        const data = safeJson(rawData)
        if (!data) continue
        if (currentEvent === "onThinking" && typeof data.reasoning_content === "string") {
          fullReasoning += data.reasoning_content
        } else if (currentEvent === "onMessageChunk" && typeof data.content === "string") {
          fullContent += data.content
        }
      }
    }
  }

  const message = {
    role: "assistant",
    content: fullContent,
  }
  if (fullReasoning) {
    message.reasoning_content = fullReasoning
  }

  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: fullContent.length,
      total_tokens: fullContent.length,
    },
  }
}

/**
 * Maps Tabbit's `/api/commerce/quota/v1/pools` and usage response into Magpie's usage shape.
 */
function usageFromQuota(poolsData, usageData) {
  const pools = Array.isArray(poolsData?.pools) ? poolsData.pools : []
  const mainPool = pools[0] || {}

  const planName = usageData?.membership_plan_details?.[0]?.plan_display_name
    || (usageData?.member_level === "standard" ? "标准版" : usageData?.member_level)
    || "标准版"

  const total = Number.parseFloat(mainPool.total_cycle_quota || "3000") || 3000
  const used = Number.parseFloat(mainPool.used_quota || "0") || 0
  const remain = Number.parseFloat(mainPool.remain_quota || String(total - used)) || (total - used)

  let resetLabel = ""
  if (usageData?.remaining_reset_hours) {
    const hours = Number.parseFloat(usageData.remaining_reset_hours)
    if (!Number.isNaN(hours)) {
      const days = Math.floor(hours / 24)
      const remHours = Math.floor(hours % 24)
      resetLabel = days > 0 ? `${days}天${remHours}小时后重置` : `${remHours}小时后重置`
    }
  }

  const percent = total > 0 ? `${((remain / total) * 100).toFixed(1)}%` : "100%"

  return {
    plan: planName,
    signIn: "kept",
    windows: [
      {
        name: "周剩余用量",
        used: Math.round(used),
        amount: Math.round(used),
        limit: Math.round(total),
        display: `${percent} (剩余 ${Math.round(remain)} 点${resetLabel ? ` · ${resetLabel}` : ""})`,
        unit: "points",
      },
    ],
  }
}

// ---- The Plugin ------------------------------------------------------------

export const TabbitAuthPlugin = async ({ client } = {}, options = {}) => {
  const fetcher = typeof options?.fetch === "function" ? options.fetch : fetch
  const env = options?.env ?? process.env
  const apiBase = (env?.TABBIT_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "")

  const configModel = (m) => ({
    name: m.name ?? m.id,
    limit: { context: m.context ?? 1000000, output: 0 },
    tool_call: true,
    reasoning: m.reasoning ?? true,
  })

  return {
    // 1. Initial configuration
    config: async (config) => {
      config.provider ??= {}
      config.provider[PROVIDER] ??= {}
      const p = config.provider[PROVIDER]
      p.name ??= "Tabbit"
      p.npm ??= NPM
      p.api ??= `${apiBase}/v1`
      p.options ??= {}
      p.options.apiKey ??= SESSION_API_KEY
      p.models = { ...Object.fromEntries(CATALOG.map((m) => [m.id, configModel(m)])), ...(p.models ?? {}) }
    },

    // 2. Dynamic model discovery
    provider: {
      id: PROVIDER,
      async models(provider, { auth } = {}) {
        const cookie = cleanCookie(auth?.access || auth?.key || "")
        if (!cookie) return provider.models
        try {
          const res = await fetcher(`${apiBase}/proxy/v1/model_config/models?a=0&scene=chat`, {
            method: "GET",
            headers: buildTabbitHeaders(cookie),
          })
          if (!res.ok) return provider.models
          const data = await res.json().catch(() => null)
          const liveModels = parseRemoteModels(data)
          if (Object.keys(liveModels).length === 0) return provider.models
          return { ...provider.models, ...liveModels }
        } catch {
          return provider.models
        }
      },
    },

    // 3. Authentication & Request Adapter
    auth: {
      provider: PROVIDER,
      maxConcurrency: 4,

      async loader(getAuth) {
        const auth = await getAuth()
        const cookie = cleanCookie(auth?.access || auth?.key || "")
        if (!cookie) return {}

        return {
          apiKey: SESSION_API_KEY,
          baseURL: `${apiBase}/v1`,

          async fetch(input, init = {}) {
            const req = typeof Request !== "undefined" && input instanceof Request ? input : null
            const url = req ? req.url : String(input)
            const method = String(init?.method ?? req?.method ?? "GET").toUpperCase()

            // Pass through non-chat requests
            if (!url.includes("/chat/completions")) {
              return fetcher(input, init)
            }

            let bodyText = ""
            if (typeof init?.body === "string") {
              bodyText = init.body
            } else if (init?.body != null) {
              const u8 = init.body instanceof Uint8Array ? init.body : new Uint8Array(init.body)
              bodyText = new TextDecoder().decode(u8)
            } else if (req) {
              bodyText = await req.clone().text()
            }

            const openaiBody = safeJson(bodyText) || {}
            const isStream = Boolean(openaiBody.stream)
            const modelId = openaiBody.model || "默认"

            // 1. Create or ensure a chat room
            let roomId = "temp_room"
            try {
              const roomRes = await fetcher(`${apiBase}/api/v3/chat/rooms`, {
                method: "POST",
                headers: buildTabbitHeaders(cookie),
                body: JSON.stringify({ room_name: "Magpie Chat" }),
              })
              if (roomRes.ok) {
                const roomData = await roomRes.json().catch(() => null)
                if (roomData?.room_id) roomId = roomData.room_id
              }
            } catch {
              /* ignore and use fallback */
            }

            // 2. Submit conversation run
            const runPayload = buildTabbitRunPayload(openaiBody)
            const runRes = await fetcher(`${apiBase}/api/v3/chat/rooms/${roomId}/runs`, {
              method: "POST",
              headers: buildTabbitHeaders(cookie),
              body: JSON.stringify(runPayload),
            })

            if (!runRes.ok) {
              const errText = await runRes.text().catch(() => "")
              return new Response(JSON.stringify({ error: { message: `Tabbit error ${runRes.status}: ${errText}` } }), {
                status: runRes.status,
                headers: { "Content-Type": "application/json" },
              })
            }

            const runData = await runRes.json().catch(() => null)
            const runId = runData?.run_id || runPayload.client_run_id

            // 3. Join the SSE stream
            const streamRes = await fetcher(`${apiBase}/api/v3/chat/rooms/${roomId}/join`, {
              method: "POST",
              headers: {
                ...buildTabbitHeaders(cookie),
                "Accept": "text/event-stream",
              },
              body: JSON.stringify({ run_id: runId }),
            })

            if (!streamRes.ok || !streamRes.body) {
              // Fallback to turn stream if join endpoint fails
              const fallbackRes = await fetcher(`${apiBase}/api/v2/chat/turns/${runId}/stream`, {
                method: "GET",
                headers: {
                  ...buildTabbitHeaders(cookie),
                  "Accept": "text/event-stream",
                },
              })
              if (!fallbackRes.ok || !fallbackRes.body) {
                return streamRes
              }
            }

            const activeStream = streamRes.body || fallbackRes.body
            const transform = createOpenAIStreamTransform(modelId)

            if (isStream) {
              const transformed = activeStream.pipeThrough(transform)
              return new Response(transformed, {
                status: 200,
                headers: {
                  "Content-Type": "text/event-stream; charset=utf-8",
                  "Cache-Control": "no-cache",
                  "Connection": "keep-alive",
                },
              })
            }

            // Non-streaming: aggregate full completion
            const completeJson = await aggregateStreamToCompletion(activeStream, modelId)
            return new Response(JSON.stringify(completeJson), {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            })
          },
        }
      },

      // 4. Usage & Quota reporting
      async usage(getAuth) {
        const auth = await getAuth()
        const cookie = cleanCookie(auth?.access || auth?.key || "")
        if (!cookie) return null

        try {
          // Fetch user base info for user_id
          const userRes = await fetcher(`${apiBase}/api/v0/user/base-info`, {
            method: "GET",
            headers: buildTabbitHeaders(cookie),
          })
          let userId = extractUserId(cookie)
          if (userRes.ok) {
            const udata = await userRes.json().catch(() => null)
            if (udata?.user_info?.id) userId = udata.user_info.id
          }

          // Fetch quota pools & usage details
          const [poolsRes, usageRes] = await Promise.all([
            fetcher(`${apiBase}/api/commerce/quota/v1/pools?user_id=${encodeURIComponent(userId)}&cycle_offset=0`, {
              method: "GET",
              headers: buildTabbitHeaders(cookie),
            }).then((r) => r.json()).catch(() => null),
            fetcher(`${apiBase}/api/commerce/quota/v1/usage?user_id=${encodeURIComponent(userId)}`, {
              method: "GET",
              headers: buildTabbitHeaders(cookie),
            }).then((r) => r.json()).catch(() => null),
          ])

          return usageFromQuota(poolsRes, usageRes)
        } catch (e) {
          return { error: `无法获取 Tabbit 额度: ${e.message}`, windows: [] }
        }
      },

      methods: [
        {
          type: "api",
          label: "Tabbit 网页会话 Cookie (粘贴 web.tabbit.com Cookie)",
          placeholder: "例如: session-token=... 或从浏览器复制 document.cookie",
          async authorize(inputs) {
            const cookie = cleanCookie(inputs?.key || inputs?.cookie || "")
            if (!cookie) return { type: "failed", error: "请输入有效的 Tabbit 会话 Cookie" }
            return {
              type: "success",
              access: cookie,
              key: cookie,
            }
          },
        },
      ],
    },
  }
}

// Internal exports for unit testing
export const _internal = {
  PROVIDER,
  NPM,
  CATALOG,
  DEFAULT_API_BASE,
  safeJson,
  cleanCookie,
  extractUserId,
  normalizeModel,
  parseRemoteModels,
  buildTabbitHeaders,
  formatChatInput,
  buildTabbitRunPayload,
  createOpenAIStreamTransform,
  aggregateStreamToCompletion,
  usageFromQuota,
}
