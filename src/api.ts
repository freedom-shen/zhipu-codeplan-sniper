import { API_BASE, HEADERS } from "./config.js";

export interface CustomerInfo {
  customerName: string;
  nickName: string;
  customerNumber: string;
}

export interface Product {
  productId: string;
  originalAmount: number;
  discountAmount: number;
  payAmount: number;
  monthlyOriginalAmount: number;
  soldOut: boolean;
  canPurchase: boolean | null;
  campaignDiscountDetails: Array<{
    campaignName: string;
    campaignDiscountAmount: number;
    rewardMode: string;
    rewardAmount: number;
    rewardDetail: string;
    applyScene: string;
  }>;
}

export interface BatchPreviewResult {
  success: boolean;
  code: number;
  msg: string;
  data: {
    productList: Product[];
    isSubscribed: boolean;
  };
  /** 响应 Date 头解析出的服务器时间（秒级精度），用于校时 */
  serverDate: Date | null;
}

export interface CreatePreOrderResult {
  success: boolean;
  code: number;
  msg: string;
  data: {
    bizId: string;
  } | null;
}

export class ApiClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private get headers(): Record<string, string> {
    return {
      ...HEADERS,
      Authorization: this.token,
    };
  }

  async getCustomerInfo(): Promise<CustomerInfo> {
    const res = await fetch(`${API_BASE}/api/biz/customer/getCustomerInfo`, {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Token 已过期，请重新登录 Chrome");
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(`验证失败: ${data.msg}`);
    }
    return {
      customerName: data.data.customerName,
      nickName: data.data.nickName,
      customerNumber: data.data.customerNumber,
    };
  }

  async batchPreview(): Promise<BatchPreviewResult> {
    const res = await fetch(`${API_BASE}/api/biz/pay/batch-preview`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ invitationCode: "" }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Token 已过期，请重新登录 Chrome");
    }

    const body = await res.json();
    const dateHeader = res.headers.get("date");
    body.serverDate = dateHeader ? new Date(dateHeader) : null;
    return body;
  }

  async createPreOrder(
    productId: string,
    payPrice: number
  ): Promise<CreatePreOrderResult> {
    const res = await fetch(`${API_BASE}/api/biz/product/createPreOrder`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        productId,
        payPrice,
        num: 1,
        isMobile: false,
        channelCode: "WEB",
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Token 已过期，请重新登录 Chrome");
    }

    return res.json();
  }
}
