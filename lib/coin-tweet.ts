import { z } from "zod";

export const coinTweetUrl = z.string().trim().max(500).default("").transform((value, context) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname) ||
        !/^\/(?:[A-Za-z0-9_]{1,15}|i)\/status\/\d+\/?$/.test(url.pathname)) throw new Error();
    return "https://x.com" + url.pathname.replace(/\/$/, "");
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Paste a valid HTTPS X or Twitter post URL." });
    return z.NEVER;
  }
});
