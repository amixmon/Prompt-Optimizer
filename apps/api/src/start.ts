// Set the mode before importing the app so npm start works across platforms.
process.env.NODE_ENV = "production";
await import("./index.js");
