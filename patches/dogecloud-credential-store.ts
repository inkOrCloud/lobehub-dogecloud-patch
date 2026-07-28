/**
 * DogeCloud 多吉云 S3 临时凭证存储
 *
 * 从多吉云 API 获取临时 STS 凭证以及 s3Endpoint / s3Bucket。
 * 凭证自动缓存并在过期前刷新；s3Endpoint / s3Bucket 在模块加载时通过
 * 首次 API 调用获取，也可通过环境变量 S3_ENDPOINT / S3_BUCKET 手动覆盖。
 *
 * ## 环境变量
 *
 * | 变量 | 必填 | 说明 |
 * |------|------|------|
 * | DOGECLOUD_ACCESS_KEY | ✅ | 多吉云永久 AccessKey |
 * | DOGECLOUD_SECRET_KEY | ✅ | 多吉云永久 SecretKey |
 * | DOGECLOUD_BUCKET | ✅ | 云存储空间名称（如 my-bucket） |
 * | DOGECLOUD_CHANNEL | ❌ | 密钥类型: OSS_FULL（默认）/ OSS_UPLOAD |
 * | DOGECLOUD_SCOPES | ❌ | 权限范围，默认 * |
 * | DOGECLOUD_TTL | ❌ | 临时密钥有效期秒，默认 7200 |
 * | S3_ENDPOINT | ❌ | 手动覆盖 s3Endpoint |
 * | S3_BUCKET | ❌ | 手动覆盖 s3Bucket |
 *
 * ## 使用方式
 *
 * 在应用入口处导入即可自动注册：
 *
 * ```ts
 * import './patches/dogecloud-credential-store';
 * ```
 */

import crypto from 'node:crypto';

import {
  type S3CredentialProviderResult,
  setCredentialProvider,
} from '@/server/modules/S3';

// ─── 配置 ───────────────────────────────────────────────────────────

const {
  DOGECLOUD_ACCESS_KEY = '',
  DOGECLOUD_SECRET_KEY = '',
  DOGECLOUD_BUCKET = '',
  DOGECLOUD_CHANNEL = 'OSS_FULL',
  DOGECLOUD_SCOPES = '*',
  DOGECLOUD_TTL = '7200',

  // 可选的环境变量覆盖
  S3_ENDPOINT: ENV_S3_ENDPOINT,
  S3_BUCKET: ENV_S3_BUCKET,
} = process.env;

// ─── 运行时状态 ──────────────────────────────────────────────────────

/** 从 DogeCloud API 获取的 s3Endpoint，仅当 ENV_S3_ENDPOINT 未设时使用 */
let resolvedEndpoint: string | undefined = ENV_S3_ENDPOINT;

/** 从 DogeCloud API 获取的 s3Bucket，仅当 ENV_S3_BUCKET 未设时使用 */
let resolvedBucket: string | undefined = ENV_S3_BUCKET;

/** 缓存的临时凭证 */
interface CachedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiry: number; // unix seconds
}

let cachedCredentials: CachedCredentials | null = null;

let initPromise: Promise<void> | null = null;

// ─── DogeCloud API ──────────────────────────────────────────────────

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
    Buckets: Array<{
      name: string;
      s3Bucket: string;
      s3Endpoint: string;
    }>;
  };
}

/**
 * 生成 DogeCloud API HMAC-SHA1 签名
 * signStr = apiPath + "\n" + body
 */
function hmacSha1Hex(secret: string, data: string): string {
  return crypto.createHmac('sha1', secret).update(data, 'utf-8').digest('hex');
}

/**
 * 调用多吉云 /auth/tmp_token.json 获取临时凭证
 * 首次调用时还会更新 resolvedEndpoint / resolvedBucket
 */
async function fetchFromDogeCloud(): Promise<CachedCredentials> {
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

  const sign = hmacSha1Hex(DOGECLOUD_SECRET_KEY, apiPath + '\n' + body);
  const authorization = `TOKEN ${DOGECLOUD_ACCESS_KEY}:${sign}`;

  const response = await fetch(`https://api.dogecloud.com${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body,
  });

  if (!response.ok) {
    throw new Error(`DogeCloud API network error: ${response.status}`);
  }

  const result: DogeCloudTmpTokenResponse = await response.json();
  if (result.code !== 200) {
    throw new Error(`DogeCloud API error [${result.code}]: ${result.msg}`);
  }

  // 如果环境变量未覆盖，从 API 响应中更新 S3 配置
  if (!ENV_S3_ENDPOINT && result.data.Buckets?.length) {
    const bucketInfo =
      result.data.Buckets.find((b) => b.name === DOGECLOUD_BUCKET) ??
      result.data.Buckets[0];
    resolvedEndpoint ||= bucketInfo.s3Endpoint;
    resolvedBucket ||= bucketInfo.s3Bucket;
  }

  return {
    accessKeyId: result.data.Credentials.accessKeyId,
    secretAccessKey: result.data.Credentials.secretAccessKey,
    sessionToken: result.data.Credentials.sessionToken,
    expiry: result.data.ExpiredAt,
  };
}

/**
 * 确保至少有一次成功的 API 调用，以便获取 endpoint / bucket。
 * 在模块加载时自动触发，后续手动调用只刷新凭证。
 */
async function ensureInitialized(): Promise<void> {
  if (resolvedEndpoint && resolvedBucket && cachedCredentials) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    cachedCredentials = await fetchFromDogeCloud();
  })();

  return initPromise;
}

// 模块加载时立即触发首次获取（fire-and-forget）
ensureInitialized().catch((err) => {
  console.warn('[dogecloud] 首次获取 S3 配置失败，将依赖环境变量回退:', err.message);
});

// ─── 注册凭证提供者 ─────────────────────────────────────────────────

export function registerDogeCloudCredentialProvider(): void {
  if (!DOGECLOUD_ACCESS_KEY || !DOGECLOUD_SECRET_KEY || !DOGECLOUD_BUCKET) {
    console.warn(
      '[dogecloud] DOGECLOUD_ACCESS_KEY / DOGECLOUD_SECRET_KEY / DOGECLOUD_BUCKET 未完整配置，跳过注册',
    );
    return;
  }

  setCredentialProvider((): S3CredentialProviderResult => {
    // 如果首次获取还没完成，同步返回 undefined endpoint/bucket
    // 此时 `FileS3` 构造函数会回退到 S3_ENDPOINT / S3_BUCKET 环境变量
    // 如果环境变量也没设，则在构造函数中报错

    return {
      get endpoint(): string | undefined {
        return resolvedEndpoint;
      },
      get bucket(): string | undefined {
        return resolvedBucket;
      },

      credentials: async () => {
        const now = Math.floor(Date.now() / 1000);

        // 缓存仍然有效且距离过期 > 5 分钟 → 复用
        if (cachedCredentials && cachedCredentials.expiry > now + 300) {
          return {
            accessKeyId: cachedCredentials.accessKeyId,
            secretAccessKey: cachedCredentials.secretAccessKey,
            sessionToken: cachedCredentials.sessionToken,
            expiration: new Date(cachedCredentials.expiry * 1000),
          };
        }

        // 获取/刷新凭证，同时更新 endpoint / bucket
        cachedCredentials = await fetchFromDogeCloud();

        return {
          accessKeyId: cachedCredentials.accessKeyId,
          secretAccessKey: cachedCredentials.secretAccessKey,
          sessionToken: cachedCredentials.sessionToken,
          expiration: new Date(cachedCredentials.expiry * 1000),
        };
      },
    };
  });

  if (ENV_S3_ENDPOINT && ENV_S3_BUCKET) {
    console.log('[dogecloud] 已注册凭证提供者（S3_ENDPOINT / S3_BUCKET 由环境变量指定）');
  } else if (resolvedEndpoint && resolvedBucket) {
    console.log('[dogecloud] 已注册凭证提供者（S3 配置从 DogeCloud API 动态获取）');
  } else {
    console.log('[dogecloud] 已注册凭证提供者（S3 配置等待首次 API 返回后生效）');
  }
}

// 模块导入时自动注册
registerDogeCloudCredentialProvider();
