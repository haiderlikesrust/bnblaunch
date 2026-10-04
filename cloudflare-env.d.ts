declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    APP_ORIGIN?: string;
    SHEN_TOKEN_ADDRESS?: string;
    SHEN_RUNTIME?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_IMAGE_MODEL?: string;
    BRAVE_API_KEY?: string;
    BNB_RPC_URL?: string;
    WORKER_TOKEN?: string;
    SIGNER_URL?: string;
    SIGNER_WEB_TOKEN?: string;
    SIGNER_SETTLEMENT_ADDRESS?: string;
    OPENROUTER_MANAGEMENT_KEY?: string;
    BRAVE_COST_MICROUSD?: string;
    BROWSER_URL?: string;
    BROWSER_TOKEN?: string;
    X_CLIENT_ID?: string;
    X_CLIENT_SECRET?: string;
    X_API_BEARER_TOKEN?: string;
    X_POST_URL_COST_MICROUSD?: string;
    SERVICE_CREDENTIALS_KEY?: string;
    X_LOGIN_DAILY_LIMIT_MICROUSD?: string;
    X_POST_COST_MICROUSD?: string;
    X_UPLOAD_COST_MICROUSD?: string;
    X_READ_COST_MICROUSD?: string;
    CHAT_DAILY_LIMIT_MICROUSD?: string;
    PORKBUN_API_KEY?: string;
    PORKBUN_SECRET_KEY?: string;
    DOMAIN_AUTO_FUNDING_ENABLED?: string;
    DOKPLOY_URL?: string;
    DOKPLOY_API_KEY?: string;
    DOKPLOY_COMPOSE_ID?: string;
    HOSTING_IPV4?: string;
    RELAY_API_KEY?: string;
  }
}
