/**
 * Gemma 4 参赛演示版 - AI 集中配置
 */
window.RDC_AI_CONFIG = {
  provider: "google",
  modelFamily: "Gemma",
  modelName: "Gemma 4",
  modelId: "gemma-4-26b-it",
  demoMode: true, // 开启演示模式，不请求真实接口
  apiKey: "GEMMA_API_KEY_PLACEHOLDER", // 占位符，不存放真实 Key
  apiVersion: "v1beta",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-it:generateContent"
};
