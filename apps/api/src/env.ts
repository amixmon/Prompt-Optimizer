import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch (error) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
    throw error;
  }
}
