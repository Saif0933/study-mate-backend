import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getEnv } from "../config/env";
import { logger } from "./logger";
import { BadRequestError } from "./errors";

/**
 * Validates PDF magic bytes signature (%PDF- / 0x25 0x50 0x44 0x46 0x2D).
 * According to PDF specification, %PDF- should appear within the first 1024 bytes.
 */
export function validatePdfSignature(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) {
    return false;
  }
  // Check the first 1024 bytes for '%PDF-'
  const headerSlice = buffer.subarray(0, Math.min(1024, buffer.length));
  return headerSlice.includes(Buffer.from("%PDF-"));
}

/**
 * Computes SHA-256 checksum of a buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export class FileStorageService {
  /**
   * Resolves the absolute path for private storage.
   */
  private getStorageBasePath(): string {
    const env = getEnv();
    return path.resolve(process.cwd(), env.UPLOAD_DIR);
  }

  /**
   * Saves uploaded document buffer into a private user-isolated directory.
   */
  async saveDocumentFile(
    userId: string,
    documentId: string,
    buffer: Buffer
  ): Promise<{ storageKey: string; checksum: string; sizeBytes: number }> {
    if (!validatePdfSignature(buffer)) {
      throw new BadRequestError("Invalid file signature: uploaded file is not a valid PDF document");
    }

    const checksum = computeSha256(buffer);
    const storageKey = `documents/${userId}/${documentId}.pdf`;
    const fullPath = path.join(this.getStorageBasePath(), storageKey);

    // Ensure user directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    // Write file to private disk
    await fs.writeFile(fullPath, buffer);
    logger.info({ userId, documentId, storageKey, sizeBytes: buffer.length }, "Private document saved to storage");

    return {
      storageKey,
      checksum,
      sizeBytes: buffer.length,
    };
  }

  /**
   * Reads a private document buffer from disk.
   */
  async readDocumentFile(storageKey: string): Promise<Buffer> {
    const fullPath = path.join(this.getStorageBasePath(), storageKey);
    return await fs.readFile(fullPath);
  }

  /**
   * Safely deletes a document file from storage.
   * Tolerates missing files to ensure idempotent deletion.
   */
  async deleteDocumentFile(storageKey: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.getStorageBasePath(), storageKey);
      await fs.unlink(fullPath);
      logger.info({ storageKey }, "Document file deleted from private storage");
      return true;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        logger.warn({ storageKey }, "Document file was already removed from storage");
        return true;
      }
      logger.error({ err: err.message, storageKey }, "Failed to delete document file from storage");
      return false;
    }
  }

  /**
   * Safely deletes all storage files and directories associated with a user.
   * Tolerates missing folders to ensure idempotent deletion.
   */
  async deleteUserStorage(userId: string): Promise<boolean> {
    try {
      const userDir = path.join(this.getStorageBasePath(), "documents", userId);
      await fs.rm(userDir, { recursive: true, force: true });
      logger.info({ userId }, "User storage directory and documents removed from disk");
      return true;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return true;
      }
      logger.error({ err: err.message, userId }, "Failed to delete user storage directory");
      return false;
    }
  }
}

export const fileStorageService = new FileStorageService();
