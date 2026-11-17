import { randomUUID } from 'node:crypto';
import { S3Client, type S3Config } from '../src/storage/s3-client';

/**
 * WP1.20: testovi nad stvarnim S3-kompatibilnim poslužiteljem (MinIO, `sh scripts/minio-test.sh up`).
 * Bez TEST_S3_ENDPOINT preskaču se s vidljivom porukom; ako je postavljen, a poslužitelj nije dostupan, testovi PADAJU
 * (nikad tiho ne prolaze). Vjerodajnice su testne (samo lokalni MinIO i CI).
 */
export const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? '';
export const s3Enabled = S3_ENDPOINT !== '';
export const S3_SKIP_MESSAGE = '[WP1.20] TEST_S3_ENDPOINT nije postavljen – testovi nad S3/MinIO se PRESKAČU. Pokreni: sh scripts/minio-test.sh up, zatim TEST_S3_ENDPOINT=http://127.0.0.1:9100 TEST_S3_ACCESS_KEY_ID=arqus-test TEST_S3_SECRET_ACCESS_KEY=arqus-test-secret-123';
if (!s3Enabled) console.warn(S3_SKIP_MESSAGE);

export const S3_BUCKET = process.env.TEST_S3_BUCKET ?? 'arqus-test';

export function testS3Config(prefix: string, bucket = S3_BUCKET): S3Config {
  return {
    endpoint: S3_ENDPOINT, region: process.env.TEST_S3_REGION ?? 'us-east-1', bucket,
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'arqus-test', secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'arqus-test-secret-123',
    forcePathStyle: true, prefix, timeoutMs: 10000, retries: 1,
  };
}

/** Jedinstveni prefiks po pokretanju (testovi ne dijele objekte, bucket se ne mora prazniti). */
export const uniquePrefix = (name: string) => `t-${name}-${randomUUID().slice(0, 8)}/`;

export async function testClient(prefix: string, bucket = S3_BUCKET): Promise<S3Client> {
  const c = new S3Client(testS3Config(prefix, bucket));
  await c.createBucket();
  return c;
}

/** Varijable okruženja za aplikaciju s DOCUMENTS_STORAGE=s3 (ili drugim prefiksom varijabli). */
export function s3Env(prefix: string, envPrefix = 'DOCUMENTS_S3_', bucket = S3_BUCKET): Record<string, string> {
  const c = testS3Config(prefix, bucket);
  return {
    [`${envPrefix}ENDPOINT`]: c.endpoint, [`${envPrefix}REGION`]: c.region, [`${envPrefix}BUCKET`]: c.bucket, [`${envPrefix}ACCESS_KEY_ID`]: c.accessKeyId,
    [`${envPrefix}SECRET_ACCESS_KEY`]: c.secretAccessKey, [`${envPrefix}FORCE_PATH_STYLE`]: 'true', [`${envPrefix}PREFIX`]: prefix, [`${envPrefix}TIMEOUT_MS`]: '10000',
  };
}
