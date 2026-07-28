/**
 * DogeCloud 多吉云 S3 临时凭证存储
 *
 * 从多吉云 API 获取临时 STS 凭证，自动缓存并在过期前刷新。
 * 与 LobeHub 的 S3 动态凭证钩子配合使用。
 *
 * ## 环境变量
 *
 * | 变量 | 必填 | 说明 |
 * |------|------|------|
 * | DOGECLOUD_ACCESS_KEY | ✅ | 多吉云永久 AccessKey（用户中心→密钥管理） |
 * | DOGECLOUD_SECRET_KEY | ✅ | 多吉云永久 SecretKey |
 * | DOGECLOUD_BUCKET | ✅ | 云存储空间名称（如 my-bucket） |
 * | DOGECLOUD_CHANNEL | ❌ | 密钥类型：OSS_FULL（默认） / OSS_UPLOAD / OSS_CUSTOM |
 * | DOGECLOUD_SCOPES | ❌ | 权限范围，默认 `*` |
 * | DOGECLOUD_TTL | ❌ | 临时密钥有效期，单位秒，范围 0~7200，默认 7200 |
 *
 * ## 使用方式
 *
 * 在应用入口处导入此文件即可自动注册：
 *
 * ```ts
 * // apps/server/src/index.ts 或类似入口
 * import './patches/dogecloud-credential-store';
 * ```
 *
 * 此后所有 `new FileS3()` 创建的 S3 客户端都会自动使用 DogeCloud
 * 临时凭证，无需修改任何业务代码。
 */

import crypto from 'node:crypto';

import { setCredentialProvider } from '@/server/modules/S3';

// ─── 配置 ───────────────────────────────────────────────────────────

const {
  DOGECLOUD_ACCESS_KEY = '',
  DOGECLOUD_SECRET_KEY = '',
  DOGECLOUD_BUCKET = '',
  DOGECLOUD_CHANNEL = 'OSS_FULL',
  DOGECLOUD_SCOPES = '*',
  DOGECLOUD_TTL = '7200',
} = process.env;

// ─── 缓存 ───────────────────────────────────────────────────────────

let cachedCredentials: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiry: number; // unix seconds
} | null = null;

// ─── DogeCloud API HMAC-SHA1 签名 ───────────────────────────────────

/**
 * 生成 DogeCloud API 请求签名
 * 算法：HMAC-SHA1(signStr, SecretKey)，结果转 hex
 * signStr = apiPath + "\n" + body
 */
function signRequest(apiPath: string, body: string): string {
  return crypto
    .createHmac('sha1', DOGECLOUD_SECRET_KEY)
    .update(apiPath + '\n' + body, 'utf-8')
    .digest('hex');
}

// ─── 获取临时凭证 ───────────────────────────────────────────────────

interface DogeCloudTmpTokenResponse {
  code: number;
  err_code?: string;
  msg: string;
  data: {
    Credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    };
    ExpiredAt: number;
    Buckets?: Array<{
      name: string;
      s3Bucket: string;
      s3Endpoint: string;
    }>;
  };
}

async function fetchTemporaryCredentials(): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiry: number;
}> {
  const apiPath = '/auth/tmp_token.json';

  const scopes = DOGECLOUD_SCOPES.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === '*' ? `${DOGECLOUD_BUCKET}:*` : `${DOGECLOUD_BUCKET}:${s}`));

  const body = JSON.stringify({
    channel: DOGECLOUD_CHANNEL,
    scopes,
    ttl: Math.min(Math.max(parseInt(DOGECLOUD_TTL) || 7200, 0), 7200),
  });

  const sign = signRequest(apiPath, body);
  const authorization = `TOKEN ${DOGECLOUD_ACCESS_KEY}:${sign}`;

  const response = await fetch(`https://api.dogecloud.com${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `DogeCloud API network error: ${response.status} ${response.statusText}`,
    );
  }

  const result: DogeCloudTmpTokenResponse = await response.json();

  if (result.code !== 200) {
    throw new Error(
      `DogeCloud API error [${result.code}]: ${result.msg} (${result.err_code ?? ''})`,
    );
  }

  return {
    accessKeyId: result.data.Credentials.accessKeyId,
    secretAccessKey: result.data.Credentials.secretAccessKey,
    sessionToken: result.data.Credentials.sessionToken,
    expiry: result.data.ExpiredAt,
  };
}

// ─── 注册凭证提供者 ─────────────────────────────────────────────────

/**
 * 将 DogeCloud 临时凭证提供者注册到 S3 类。
 * 此函数会在应用启动时由模块导入自动调用。
 */
export function registerDogeCloudCredentialProvider(): void {
  if (!DOGECLOUD_ACCESS_KEY || !DOGECLOUD_SECRET_KEY || !DOGECLOUD_BUCKET) {
    console.warn(
      '[dogecloud-credential-store] 环境变量 DOGECLOUD_ACCESS_KEY / DOGECLOUD_SECRET_KEY / DOGECLOUD_BUCKET 未完整配置，跳过注册',
    );
    return;
  }

  setCredentialProvider(() => async () => {
    const now = Math.floor(Date.now() / 1000);

    // 缓存仍然有效且距离过期还有 5 分钟以上 → 复用
    if (cachedCredentials && cachedCredentials.expiry > now + 300) {
      return {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
        expiration: new Date(cachedCredentials.expiry * 1000),
      };
    }

    // 获取新的临时凭证
    const creds = await fetchTemporaryCredentials();
    cachedCredentials = creds;

    return {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      expiration: new Date(creds.expiry * 1000),
    };
  });

  console.log('[dogecloud-credential-store] 已注册 DogeCloud S3 临时凭证提供者');
}

// 模块导入时自动注册
registerDogeCloudCredentialProvider();
