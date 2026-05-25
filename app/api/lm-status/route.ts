import { NextResponse } from "next/server";

const DEFAULT_ENDPOINT = process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_MODEL = process.env.LMSTUDIO_MODEL ?? "gemma-4-4b";

function modelsUrl(endpoint: string) {
  return endpoint.replace(/\/chat\/completions\/?$/, "/models");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint") || DEFAULT_ENDPOINT;

  try {
    const response = await fetch(modelsUrl(endpoint), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`LM Studio models ${response.status}`);

    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = data.data?.map(model => model.id).filter((id): id is string => Boolean(id)) ?? [];
    return NextResponse.json({
      connected: true,
      mode: "connected",
      endpoint,
      model: models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : (models[0] ?? DEFAULT_MODEL),
      models,
      source: "lmstudio"
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      mode: "fallback",
      endpoint,
      model: DEFAULT_MODEL,
      models: [],
      source: "mock",
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
