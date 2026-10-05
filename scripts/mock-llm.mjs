// Plumbing-only mock of an OpenAI-compatible endpoint, for exercising the
// LLM code paths (distillation, judge + explanation gate, postcard polish)
// without real credentials. Its outputs are canned; they are NOT evidence of
// real-model personality quality. Some replies are deliberately invalid
// (bad JSON, invented numbers, unknown principle ids) to prove the gates
// fall back instead of letting them through.
//
// Usage: node scripts/mock-llm.mjs [port]   → http://127.0.0.1:<port>/v1/chat/completions

import http from "node:http";

const PORT = Number(process.argv[2] ?? 11434);
let n = 0;
const stats = { distill: 0, judge: 0, postcard: 0, invalid: 0 };

function reply(content) {
  return JSON.stringify({ choices: [{ message: { role: "assistant", content } }] });
}

const server = http.createServer((req, res) => {
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-plumbing" }] }));
    return;
  }
  if (req.url === "/__stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    n++;
    const parsed = JSON.parse(body || "{}");
    const system = parsed.messages?.[0]?.content ?? "";
    const user = parsed.messages?.[1]?.content ?? "";
    res.writeHead(200, { "Content-Type": "application/json" });
    if (system.includes("记忆系统")) {
      stats.distill++;
      if (n % 5 === 0) {
        stats.invalid++;
        return res.end(reply("这不是 JSON"));
      }
      const domain = /情境类型：(\w+)/.exec(user)?.[1] ?? "trust";
      const choice = /玩家选择：(.+)/.exec(user)?.[1] ?? "";
      return res.end(reply(JSON.stringify({ principle: `（模型）${choice.slice(0, 8)}也是一种答案`.slice(0, 20), domain })));
    }
    if (system.includes("守护灵") && system.includes("decision")) {
      stats.judge++;
      const ids = Array.from(system.matchAll(/\[P(\d+)\]/g)).map((m) => Number(m[1]));
      if (n % 3 === 0) {
        stats.invalid++; // invented number → must fail the explanation gate
        return res.end(reply(JSON.stringify({ decision: "拒绝", cited_principle_ids: ids.slice(0, 1), reason: "x", to_player: "我上个月亏了 9999 Scrip，不去。" })));
      }
      return res.end(
        reply(JSON.stringify({ decision: n % 2 ? "拒绝" : "调整", cited_principle_ids: ids.slice(0, 1), reason: "依据原则", to_player: "这次我想按自己的原则来。" })),
      );
    }
    stats.postcard++;
    const draft = user.split("\n").slice(2);
    if (n % 4 === 0) {
      stats.invalid++;
      return res.end(reply(draft.join("\n") + "\n另外 Zed 给了我 777 Scrip。"));
    }
    return res.end(reply(draft.join("\n")));
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock LLM on http://127.0.0.1:${PORT}/v1/chat/completions`));
