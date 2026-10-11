// Unit tests for the Tabbit Magpie provider plugin. Run with: node --test

import test from "node:test"
import assert from "node:assert/strict"

import { TabbitAuthPlugin, _internal as x } from "./index.mjs"

// ---- Helpers & Text processing ---------------------------------------------

test("cleanCookie trims and removes leading Cookie prefix and extra newlines", () => {
  assert.equal(x.cleanCookie("  Cookie: a=1; b=2  "), "a=1; b=2")
  assert.equal(x.cleanCookie("a=1\nb=2\r\nc=3"), "a=1; b=2; c=3")
  assert.equal(x.cleanCookie(""), "")
  assert.equal(x.cleanCookie(null), "")
})

test("extractUserId extracts userId from cookie or explicit override", () => {
  assert.equal(x.extractUserId("foo=bar; user_id=12345; baz=qux"), "12345")
  assert.equal(x.extractUserId("userId=abc-xyz"), "abc-xyz")
  assert.equal(x.extractUserId("a=b", "explicit-user-id"), "explicit-user-id")
  assert.equal(x.extractUserId("a=b"), "")
})

test("normalizeModel maps Tabbit model fields and enables reasoning", () => {
  const m1 = x.normalizeModel({
    model_name: "DeepSeek-V4.1-Flash",
    display_name: "DeepSeek V4.1",
    thinking: true,
  })
  assert.equal(m1.id, "DeepSeek-V4.1-Flash")
  assert.equal(m1.name, "DeepSeek V4.1")
  assert.equal(m1.reasoning, true)
  assert.equal(m1.tool_call, true)

  const m2 = x.normalizeModel({
    id: "Qwen3.5-Plus",
    name: "Qwen3.5-Plus",
    thinking: false,
  })
  assert.equal(m2.id, "Qwen3.5-Plus")
  assert.equal(m2.reasoning, false)

  assert.equal(x.normalizeModel({}), null)
})

test("parseRemoteModels handles models and data arrays", () => {
  const models = x.parseRemoteModels({
    models: [
      { model_name: "m1", display_name: "Model 1", thinking: true },
      { model_name: "m2", display_name: "Model 2", thinking: false },
    ],
  })
  assert.equal(Object.keys(models).length, 2)
  assert.equal(models["m1"].name, "Model 1")
  assert.equal(models["m2"].reasoning, false)
})

test("buildTabbitHeaders sets Content-Type, Accept, trace-id and Cookie", () => {
  const h = x.buildTabbitHeaders("session=xyz")
  assert.equal(h["Content-Type"], "application/json")
  assert.equal(h["Accept"], "application/json")
  assert.ok(h["trace-id"])
  assert.equal(h["Cookie"], "session=xyz")
})

test("formatChatInput extracts system prompt and user turns", () => {
  const inp1 = x.formatChatInput([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello world" },
  ])
  assert.ok(inp1.content.includes("You are a helpful assistant."))
  assert.ok(inp1.content.includes("Hello world"))
  assert.equal(inp1.history.length, 0)

  const inp2 = x.formatChatInput([
    { role: "user", content: "Q1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "Q2" },
  ])
  assert.equal(inp2.content, "Q2")
  assert.equal(inp2.history.length, 2)
  assert.equal(inp2.history[0].content, "Q1")
  assert.equal(inp2.history[1].content, "A1")
})

test("buildTabbitRunPayload generates valid client_run_id and input_payload", () => {
  const payload = x.buildTabbitRunPayload({
    model: "GLM-5.3",
    messages: [{ role: "user", content: "Test prompt" }],
  })
  assert.ok(payload.client_run_id)
  assert.ok(payload.client_message_id)
  assert.equal(payload.input_payload.selected_model, "GLM-5.3")
  assert.equal(payload.input_payload.content, "Test prompt")
  assert.equal(payload.input_payload.task_name, "chat")
})

// ---- SSE Stream Transform & Aggregation ------------------------------------

test("createOpenAIStreamTransform translates Tabbit SSE events to OpenAI chunks", async () => {
  const transform = x.createOpenAIStreamTransform("GLM-5.3", "chatcmpl-test")

  const sseInput = [
    'event: onReady\ndata: {"chat_session_id":"s1"}\n\n',
    'event: onThinking\ndata: {"reasoning_content":"Thinking deeply..."}\n\n',
    'event: onThinkingFinished\ndata: {}\n\n',
    'event: onMessageChunk\ndata: {"content":"Hello! "}\n\n',
    'event: onMessageChunk\ndata: {"content":"How can I help you?"}\n\n',
    'event: onRunFinish\ndata: {"status":"SUCCEEDED"}\n\n',
  ].join("")

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseInput))
      controller.close()
    },
  })

  const outputStream = readable.pipeThrough(transform)
  const reader = outputStream.getReader()
  const received = []

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received.push(typeof value === "string" ? value : new TextDecoder().decode(value))
  }

  const allText = received.join("")
  assert.ok(allText.includes('"reasoning_content":"Thinking deeply..."'))
  assert.ok(allText.includes('"content":"Hello! "'))
  assert.ok(allText.includes('"content":"How can I help you?"'))
  assert.ok(allText.includes('"finish_reason":"stop"'))
  assert.ok(allText.includes("data: [DONE]"))
})

test("aggregateStreamToCompletion aggregates SSE into a complete JSON", async () => {
  const sseInput = [
    'event: onThinking\ndata: {"reasoning_content":"Thought 1"}\n\n',
    'event: onMessageChunk\ndata: {"content":"Answer 1"}\n\n',
    'event: onMessageChunk\ndata: {"content":" and Answer 2"}\n\n',
  ].join("")

  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseInput))
      controller.close()
    },
  })

  const result = await x.aggregateStreamToCompletion(readable, "Kimi-K3", "chatcmpl-agg")
  assert.equal(result.id, "chatcmpl-agg")
  assert.equal(result.model, "Kimi-K3")
  assert.equal(result.choices[0].message.content, "Answer 1 and Answer 2")
  assert.equal(result.choices[0].message.reasoning_content, "Thought 1")
  assert.equal(result.choices[0].finish_reason, "stop")
})

test("usageFromQuota formats quota pools and usage details", () => {
  const pools = {
    pools: [
      {
        total_cycle_quota: "3000.00000000",
        used_quota: "300.00000000",
        remain_quota: "2700.00000000",
      },
    ],
  }
  const usage = {
    member_level: "standard",
    remaining_reset_hours: "68.5",
    membership_plan_details: [{ plan_display_name: "标准版" }],
  }

  const u = x.usageFromQuota(pools, usage)
  assert.equal(u.plan, "标准版")
  assert.equal(u.windows.length, 1)
  assert.equal(u.windows[0].amount, 300)
  assert.equal(u.windows[0].limit, 3000)
  assert.ok(u.windows[0].display.includes("90.0%"))
  assert.ok(u.windows[0].display.includes("2天20小时后重置"))
})

// ---- Full Plugin Lifecycle -------------------------------------------------

test("TabbitAuthPlugin exposes config, provider.models, auth.loader, auth.usage", async () => {
  const plugin = await TabbitAuthPlugin({ client: {} }, {})

  // 1. config hook
  const cfg = {}
  await plugin.config(cfg)
  assert.ok(cfg.provider.tabbit)
  assert.equal(cfg.provider.tabbit.name, "Tabbit")
  assert.ok(cfg.provider.tabbit.models["默认"])
  assert.ok(cfg.provider.tabbit.models["DeepSeek-V4.1-Flash"])

  // 2. models without auth falls back to catalog
  const modelsUnsigned = await plugin.provider.models({ models: {} }, { auth: {} })
  assert.deepEqual(modelsUnsigned, {})

  // 3. methods[0] validates cookie
  const authMethod = plugin.auth.methods[0]
  assert.equal(authMethod.type, "api")
  const failedAuth = await authMethod.authorize({ key: "" })
  assert.equal(failedAuth.type, "failed")
  const successAuth = await authMethod.authorize({ key: "session_token=valid_123" })
  assert.equal(successAuth.type, "success")
  assert.equal(successAuth.access, "session_token=valid_123")
})

test("TabbitAuthPlugin provider.models fetches live models when signed in", async () => {
  const mockFetcher = async (url) => {
    if (String(url).includes("/proxy/v1/model_config/models")) {
      return new Response(
        JSON.stringify({
          models: [
            { model_name: "DeepSeek-V4.1-Flash", display_name: "DeepSeek V4.1", thinking: true },
            { model_name: "GLM-5.3", display_name: "GLM 5.3", thinking: true },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
    return new Response("", { status: 404 })
  }

  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const live = await plugin.provider.models(
    { models: { "旧模型": { id: "旧模型" } } },
    { auth: { access: "session=123" } },
  )

  assert.ok(live["DeepSeek-V4.1-Flash"])
  assert.ok(live["GLM-5.3"])
  assert.ok(live["旧模型"])
})

test("TabbitAuthPlugin auth.loader intercepts chat and handles streaming", async () => {
  const seenRequests = []
  const mockFetcher = async (url, init) => {
    seenRequests.push({ url: String(url), init })
    const u = String(url)

    if (u.includes("/api/v3/chat/rooms") && init.method === "POST" && !u.includes("/runs") && !u.includes("/join")) {
      return new Response(JSON.stringify({ room_id: "room_101" }), { status: 200 })
    }
    if (u.includes("/runs")) {
      return new Response(JSON.stringify({ run_id: "run_202" }), { status: 200 })
    }
    if (u.includes("/join")) {
      const sseContent = [
        'event: onThinking\ndata: {"reasoning_content":"Let me solve this..."}\n\n',
        'event: onMessageChunk\ndata: {"content":"The answer is 42."}\n\n',
        'event: onRunFinish\ndata: {"status":"SUCCEEDED"}\n\n',
      ].join("")
      return new Response(new TextEncoder().encode(sseContent), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    }
    return new Response("", { status: 404 })
  }

  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const loaded = await plugin.auth.loader(async () => ({ access: "session=token123" }))

  assert.equal(loaded.baseURL, "https://web.tabbit.com/v1")
  assert.equal(loaded.apiKey, "tabbit-session")

  // Stream test
  const res = await loaded.fetch("https://web.tabbit.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "GLM-5.3",
      messages: [{ role: "user", content: "What is the meaning of life?" }],
      stream: true,
    }),
  })

  assert.equal(res.status, 200)
  assert.ok(res.headers.get("content-type").includes("text/event-stream"))

  const text = await res.text()
  assert.ok(text.includes('"reasoning_content":"Let me solve this..."'))
  assert.ok(text.includes('"content":"The answer is 42."'))
  assert.ok(text.includes("[DONE]"))

  assert.ok(seenRequests.some((r) => r.url.includes("/api/v3/chat/rooms")))
  assert.ok(seenRequests.some((r) => r.url.includes("/runs")))
  assert.ok(seenRequests.some((r) => r.url.includes("/join")))
})

test("TabbitAuthPlugin auth.loader handles non-streaming completions", async () => {
  const mockFetcher = async (url) => {
    const u = String(url)
    if (u.includes("/api/v3/chat/rooms") && !u.includes("/runs") && !u.includes("/join")) {
      return new Response(JSON.stringify({ room_id: "room_101" }), { status: 200 })
    }
    if (u.includes("/runs")) {
      return new Response(JSON.stringify({ run_id: "run_202" }), { status: 200 })
    }
    if (u.includes("/join")) {
      const sseContent = [
        'event: onThinking\ndata: {"reasoning_content":"Thinking..."}\n\n',
        'event: onMessageChunk\ndata: {"content":"Direct result."}\n\n',
        'event: onRunFinish\ndata: {"status":"SUCCEEDED"}\n\n',
      ].join("")
      return new Response(new TextEncoder().encode(sseContent), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    }
    return new Response("", { status: 404 })
  }

  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const loaded = await plugin.auth.loader(async () => ({ access: "session=token123" }))

  const res = await loaded.fetch("https://web.tabbit.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "DeepSeek-V4.1-Flash",
      messages: [{ role: "user", content: "1+1=?" }],
      stream: false,
    }),
  })

  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.model, "DeepSeek-V4.1-Flash")
  assert.equal(json.choices[0].message.content, "Direct result.")
  assert.equal(json.choices[0].message.reasoning_content, "Thinking...")
})

test("TabbitAuthPlugin auth.usage reports quota card", async () => {
  const mockFetcher = async (url) => {
    const u = String(url)
    if (u.includes("/api/v0/user/base-info")) {
      return new Response(JSON.stringify({ user_info: { id: "uid_999" } }), { status: 200 })
    }
    if (u.includes("/api/commerce/quota/v1/pools")) {
      return new Response(
        JSON.stringify({
          pools: [{ total_cycle_quota: "3000", used_quota: "150", remain_quota: "2850" }],
        }),
        { status: 200 },
      )
    }
    if (u.includes("/api/commerce/quota/v1/usage")) {
      return new Response(
        JSON.stringify({
          member_level: "standard",
          remaining_reset_hours: "48",
          membership_plan_details: [{ plan_display_name: "标准版" }],
        }),
        { status: 200 },
      )
    }
    return new Response("", { status: 404 })
  }

  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const usage = await plugin.auth.usage(async () => ({ access: "session=token123" }))

  assert.equal(usage.plan, "标准版")
  assert.equal(usage.windows[0].amount, 150)
  assert.equal(usage.windows[0].limit, 3000)
  assert.ok(usage.windows[0].display.includes("95.0%"))
  assert.ok(usage.windows[0].display.includes("2天0小时后重置"))
})

test("TabbitAuthPlugin auth.loader passes through non-chat requests", async () => {
  let called = false
  const mockFetcher = async () => {
    called = true
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const loaded = await plugin.auth.loader(async () => ({ access: "session=123" }))
  const res = await loaded.fetch("https://web.tabbit.com/v1/other-endpoint")
  assert.ok(called)
  assert.equal(res.status, 200)
})

test("TabbitAuthPlugin auth.loader surfaces Tabbit API error status code", async () => {
  const mockFetcher = async (url) => {
    if (String(url).includes("/runs")) {
      return new Response("Unauthorized session", { status: 401 })
    }
    return new Response(JSON.stringify({ room_id: "r1" }), { status: 200 })
  }
  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const loaded = await plugin.auth.loader(async () => ({ access: "session=expired" }))
  const res = await loaded.fetch("https://web.tabbit.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "GLM-5.3", messages: [{ role: "user", content: "test" }] }),
  })
  assert.equal(res.status, 401)
  const data = await res.json()
  assert.ok(data.error.message.includes("401"))
})

test("TabbitAuthPlugin auth.usage handles API failure gracefully", async () => {
  const mockFetcher = async () => {
    throw new Error("Network offline")
  }
  const plugin = await TabbitAuthPlugin({ client: {} }, { fetch: mockFetcher })
  const usage = await plugin.auth.usage(async () => ({ access: "session=123" }))
  assert.ok(usage.error.includes("Network offline"))
  assert.deepEqual(usage.windows, [])
})

