// Only these fixed messages may reach the browser. Never display an OAuth code,
// token, raw provider response, or exception text in a redirect or notification.
export const X_CONNECTION_ERRORS={
 connection_failed:['X 连接未完成。请从代币页面重新连接，以查看具体原因。','The X connection did not complete. Reconnect from the coin page to see the specific reason.'],
 session_required:['钱包登录已过期。请使用原钱包登录并重新连接 X。','Your wallet session expired. Sign in with the original wallet, then connect X again.'],
 browser_mismatch:['X 连接验证失败。请在同一浏览器中重新点击连接 X，并只保留一个授权窗口。','The X connection could not be matched to this browser. Start again from Connect X in the same browser, using one authorization window.'],
 expired:['此授权已过期或已使用。请重新点击连接 X。','This connection attempt expired or was already used. Start again from Connect X.'],
 denied:['X 授权未完成。请重新连接并批准所需权限。','X authorization was not completed. Reconnect and approve the requested permissions.'],
 oauth_client:['X 拒绝了应用凭据。平台需检查同一应用的 OAuth 2.0 Client ID、Client Secret 及回调地址。','X rejected the app credentials. The platform must check the OAuth 2.0 Client ID and Client Secret from the same confidential app, and its callback URL.'],
 token_exchange:['X 无法交换授权码。平台需检查 OAuth 应用设置和回调地址，然后重新连接。','X could not exchange the authorization code. The platform must check its OAuth app settings and callback URL, then start a fresh connection.'],
 permissions:['X 未返回所需权限或刷新令牌。请检查应用权限并重新连接。','X did not return all required permissions or a refresh token. Check the app permissions and reconnect.'],
 profile_auth:['X 无法验证授权令牌。请重新连接 X。','X could not authenticate the authorized account. Start a fresh X connection.'],
 profile_access:['X 拒绝读取授权账号。平台需检查 X API 的访问权限及计费设置。','X denied access to the authorized account profile. The platform must check its X API access and billing settings.'],
 profile_app_access:['X 拒绝此应用读取账号。请检查 OAuth 应用的项目关联、API 注册和端点访问权限。','X says this OAuth app is not enrolled or lacks access to the account-profile endpoint. Check the app’s project, API enrollment and endpoint access in the X Developer Console.'],
 profile_permissions:['X 拒绝访问授权账号资料。请检查 users.read 权限及账号限制，然后重新授权。','X says the authorized account profile is not accessible. Check users.read permission and account restrictions, then authorize again.'],
 usage_capped:['X 报告应用已达到用量上限。请在开发者控制台检查用量与计费限制。','X reports that the app’s usage cap has been reached. Check usage and billing limits in the X Developer Console.'],
 credits:['X API 余额不足。平台需充值后重试连接。','X reported insufficient API credits. The platform must fund X API access before retrying.'],
 rate_limited:['X 请求过于频繁。请稍后重新连接。','X rate-limited the connection. Wait a few minutes, then reconnect.'],
 x_unavailable:['X 暂时无法访问。请稍后重新发起连接。','X could not be reached or returned an unexpected response. Start a fresh connection shortly.'],
 account_mismatch:['此代币已绑定其他 X 账号。请重新连接原账号。','This coin is already bound to another X account. Reconnect the original account.'],
 account_in_use:['此 X 账号已绑定其他代币。请选择本代币专用账号。','This X account is already bound to another coin. Use an account dedicated to this coin.'],
 server_error:['SHEN 无法安全保存 X 连接。平台需检查服务日志和凭据加密配置。','SHEN could not securely save the X connection. The platform must check its service logs and credential-encryption configuration.'],
} as const;
export type XConnectionCode=keyof typeof X_CONNECTION_ERRORS;
export function xConnectionCode(value:unknown):XConnectionCode{return typeof value==='string'&&Object.hasOwn(X_CONNECTION_ERRORS,value)?value as XConnectionCode:'connection_failed'}
export class XConnectionError extends Error{readonly code:XConnectionCode;constructor(code:XConnectionCode){super(X_CONNECTION_ERRORS[code][1]);this.code=code}}
