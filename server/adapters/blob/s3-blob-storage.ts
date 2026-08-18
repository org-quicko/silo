import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { BlobStorage, BlobItem, BlobPutOptions, BlobGetResult } from "../../core/ports/blob-storage";

export interface S3BlobStorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  s3Client?: S3Client;
}

export class S3BlobStorage implements BlobStorage {
  private client: S3Client;
  private bucket: string;

  constructor(options: S3BlobStorageOptions) {
    this.bucket = options.bucket;

    if (options.s3Client) {
      this.client = options.s3Client;
    } else {
      const config: S3ClientConfig = {
        region: options.region || "us-east-1",
      };

      if (options.endpoint) {
        config.endpoint = options.endpoint;
      }
      if (options.forcePathStyle !== undefined) {
        config.forcePathStyle = options.forcePathStyle;
      }
      if (options.accessKeyId && options.secretAccessKey) {
        config.credentials = {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        };
      }

      this.client = new S3Client(config);
    }
  }

  async put(key: string, data: Uint8Array, options?: BlobPutOptions): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: options?.contentType,
    });
    await this.client.send(command);
  }

  async get(key: string): Promise<BlobGetResult | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;

      const bytes = await response.Body.transformToByteArray();
      return {
        data: bytes,
        contentType: response.ContentType,
        size: response.ContentLength ?? bytes.length,
      };
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  async list(prefix: string = ""): Promise<BlobItem[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });
    const response = await this.client.send(command);

    if (!response.Contents) return [];

    return response.Contents.filter((item) => item.Key !== undefined).map((item) => ({
      key: item.Key!,
      size: item.Size ?? 0,
      lastModified: item.LastModified,
    }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (err: any) {
      if (err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}
