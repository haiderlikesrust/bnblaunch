declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    APP_ORIGIN?: string;
    SHEN_RUNTIME?: string;
    BUCKET?: R2Bucket;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENROUTER_IMAGE_MODEL?: string;
    BRAVE_API_KEY?: string;
    BNB_RPC_URL?: string;
    WORKER_TOKEN?: string;
    SIGNER_URL?: string;
    SIGNER_WEB_TOKEN?: string;
    SIGNER_SETTLEMENT_ADDRESS?: string;
    OPENROUTER_MANAGEMENT_KEY?: string;
    BRAVE_COST_MICROUSD?: string;
    TWITTERAPI_IO_KEY?: string;
    TWITTERAPI_IO_PROXY?: string;
    SERVICE_CREDENTIALS_KEY?: string;
    X_LOGIN_DAILY_LIMIT_MICROUSD?: string;
    X_POST_COST_MICROUSD?: string;
    X_UPLOAD_COST_MICROUSD?: string;
    X_READ_COST_MICROUSD?: string;
    CHAT_DAILY_LIMIT_MICROUSD?: string;
    PORKBUN_API_KEY?: string;
    PORKBUN_SECRET_KEY?: string;
    RELAY_API_KEY?: string;
  }
}
