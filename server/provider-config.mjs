export const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    modelsURL: "https://api.openai.com/v1/models",
    responsesURL: "https://api.openai.com/v1/responses",
  }),
  claude: Object.freeze({
    modelsURL: "https://api.anthropic.com/v1/models?limit=100",
    messagesURL: "https://api.anthropic.com/v1/messages",
    apiVersion: "2023-06-01",
    searchTool: "web_search_20250305",
    fetchTool: "web_fetch_20250910",
  }),
});
