/**
 * CIT Platform - Main Server File
 * AI-Assisted Communication Improvement and Analysis Platform
 * Final Year University Project
 */

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

// Load environment variables
dotenv.config();

// Import database connection
const db = require("./config/database");

// Import routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const groupRoutes = require("./routes/group.routes");
const messageRoutes = require("./routes/message.routes");
const callRoutes = require("./routes/call.routes");
const analysisRoutes = require("./routes/analysis.routes");
const learningRoutes = require("./routes/learning.routes");
const dashboardRoutes = require("./routes/dashboard.routes");

// Import socket handler
const socketHandler = require("./socket/socket.handler");

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || "http://localhost:5173",
      "http://localhost:5174",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || "http://localhost:5173",
      "http://localhost:5174",
    ],
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Static files for uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Make io accessible to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/learning", learningRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "CIT Platform API is running",
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "CIT Platform API",
    version: "1.0.0",
    description: "AI-Assisted Communication Improvement and Analysis Platform",
  });
});

// Initialize Socket.IO handlers
socketHandler(io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// Handle 404 routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║                                                            ║
  ║     CIT Platform Server Running on port ${PORT}            ║
  ║                                                            ║
  ║     AI-Assisted Communication Improvement Platform         ║
  ║                                                            ║
  ╚════════════════════════════════════════════════════════════╝
  `);
  
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  process.exit(1);
});

module.exports = { app, server, io };
