import "./env.js";
import { app } from "./app.js";

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("API_PORT must be an integer between 1 and 65535.");
}

const server = app.listen(port, () => {
  console.log(`Prompt Studio API running at http://localhost:${port} (Groq AI)`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
