import { Router } from "express";
import multer from "multer";
import { documentController } from "./document.controller";
import { authenticate } from "../../middleware/authenticate";
import { messageRateLimiter } from "../../middleware/rate-limit";
import { getEnv } from "../../config/env";

export const documentRouter = Router();

// Configure multer memory storage with file size bounds
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getEnv().MAX_FILE_SIZE_BYTES,
  },
});

// All document operations require authenticated active user
documentRouter.use(authenticate);

// Document endpoints
documentRouter.post("/", upload.single("file"), documentController.uploadDocument);
documentRouter.get("/", documentController.getDocuments);
documentRouter.get("/:id", documentController.getDocument);
documentRouter.post("/:id/questions", messageRateLimiter, documentController.askQuestion);
documentRouter.post("/:id/qa", messageRateLimiter, documentController.askQuestion); // Convenience alias
documentRouter.delete("/:id", documentController.deleteDocument);
