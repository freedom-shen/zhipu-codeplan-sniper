import chromeCookies from "chrome-cookies-secure";

export async function extractToken(): Promise<string> {
  const cookies = await chromeCookies.getCookiesPromised(
    "https://open.bigmodel.cn",
    "object"
  );

  const token = cookies["bigmodel_token_production"];
  if (!token) {
    throw new Error(
      "未找到 bigmodel_token_production cookie，请先在 Chrome 中登录 open.bigmodel.cn"
    );
  }
  return token;
}
