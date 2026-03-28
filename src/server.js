// load .env
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const clientRoutes = require("./routes/clientRoutes");
const counselorRoutes = require("./routes/counselorRoutes");
const sysAdminRoutes = require("./routes/sysAdminRoutes");
const { logger } = require("./utils/logger");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { createWebSocket } = require("./websocket");

const server = express();
const host = "0.0.0.0";
const port = process.env.PORT || 3000;

// server configurations
server.use(express.json());
server.use(cookieParser());
server.use(
  cors({
    origin: ["https://cctguidance.up.railway.app"],
    credentials: true,
  })
);
server.set("trust proxy", true);

// Serve frontend static files
server.use(express.static(path.join(__dirname, "..", "public")));

// use defined endpoint from routes
server.get("/api", (req, res) => {
  res.json("Hello from my backend");
});
server.use("/api/auth", authRoutes);
server.use("/api/admin", adminRoutes);
server.use("/api/user", userRoutes);
server.use("/api/client", clientRoutes);
server.use("/api/sysadmin", sysAdminRoutes);
server.use("/api/counselor", counselorRoutes);

// handle fallback to serve frontend
server.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// centralize error handler
server.use((err, req, res, next) => {
  const ip =
    req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;

  const logData = {
    ip,
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    errors: err.errors || [],
    statusCode: err.statusCode || 500,
  };

  if (err.isOperational) {
    logger.warn("Operational error", logData);
  } else {
    logData.stack = err.stack;
    logger.error("Unhandled error", logData);
  }
  const err_res = {
    message: err.isOperational ? err.message : "Internal Server Error.",
  };
  if (err.errors) {
    err_res["error"] = err.errors;
  }
  if (err.errorCodes) {
    err_res["error_codes"] = err.errorCodes;
  }
  res.status(err.statusCode || 500).json(err_res);
});

const httpServer = http.createServer(server);

createWebSocket({ server: httpServer });

httpServer.listen(port, host, () => {
  logger.info(`HTTPS server listening on https://${host}:${port}`);
});

cron.schedule("*/1 * * * *", async () => {
  try {
    console.log("Notification routine started")
    await sendUpcomingSessionNotification({});

    console.log("Notification routine ended")
  } catch (err) {
    console.error("Cron error:", err);
  }
});

module.exports = server;
