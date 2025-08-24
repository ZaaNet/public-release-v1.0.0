"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetworkManager = getNetworkManager;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const dataHandler_1 = require("./services/dataHandler");
const networkSingleton_service_1 = require("./services/networkSingleton.service");
const onboard_routes_1 = __importDefault(require("./routes/onboard.routes"));
const localPayments_routes_1 = __importDefault(require("./routes/localPayments.routes"));
const manageSession_routes_1 = __importDefault(require("./routes/manageSession.routes"));
// Environment validation
function validateEnvironment() {
    const required = ["CONTRACT_ID"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(", ")}`);
        process.exit(1);
    }
    return {
        contractId: Number(process.env.CONTRACT_ID),
    };
}
// SSL certificate loading
function loadSSLCertificates() {
    const keyPath = path_1.default.resolve(__dirname, "../certs/key.pem");
    const certPath = path_1.default.resolve(__dirname, "../certs/cert.pem");
    try {
        if (!fs_1.default.existsSync(keyPath) || !fs_1.default.existsSync(certPath)) {
            console.warn(`SSL certificates not found`);
            return null;
        }
        const key = fs_1.default.readFileSync(keyPath);
        const cert = fs_1.default.readFileSync(certPath);
        if (key.length === 0 || cert.length === 0) {
            console.warn("SSL certificate files are empty");
            return null;
        }
        console.log("SSL certificates loaded successfully");
        return { key, cert };
    }
    catch (error) {
        console.error("Failed to load SSL certificates:", error instanceof Error ? error.message : error);
        return null;
    }
}
// Initialize NetworkManager instead of separate firewall
function initializeNetworkManager(contractId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield networkSingleton_service_1.networkManagerSingleton.initialize(contractId);
    });
}
// Service initialization
function initializeServices() {
    return __awaiter(this, void 0, void 0, function* () {
        const services = [
            {
                name: "NetworkManager",
                fn: () => initializeNetworkManager(process.env.CONTRACT_ID || ""),
            },
            {
                name: "Data Usage Sync",
                fn: () => (0, dataHandler_1.startDataUsageSync)(),
            }
        ];
        for (const service of services) {
            try {
                console.log(`🔄 Initializing ${service.name}...`);
                yield service.fn();
                console.log(`✅ ${service.name} initialized`);
            }
            catch (error) {
                console.error(`Failed to initialize ${service.name}:`, error);
                throw error;
            }
        }
    });
}
// Export NetworkManager for use in controllers
function getNetworkManager() {
    if (!networkSingleton_service_1.networkManagerSingleton) {
        throw new Error("NetworkManager not initialized");
    }
    return networkSingleton_service_1.networkManagerSingleton.getNetworkManager();
}
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        const env = validateEnvironment();
        yield initializeServices();
        const app = (0, express_1.default)();
        // Simple CORS - no complex captive portal detection needed
        app.use((0, cors_1.default)({
            origin: ["https://portal.zaanet.xyz", "http://portal.zaanet.xyz"],
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
            credentials: true,
        }));
        app.use((0, cookie_parser_1.default)());
        app.use(express_1.default.json({ limit: "50mb" }));
        app.use(express_1.default.urlencoded({ extended: true, limit: "50mb" }));
        // Trust proxy to get real IP addresses
        app.set("trust proxy", true);
        // Application routes
        app.use("/api/payments", localPayments_routes_1.default);
        app.use("/api/onboard", onboard_routes_1.default);
        app.use("/api/analytics", manageSession_routes_1.default);
        // Portal frontend serving with simplified React support
        const buildPath = path_1.default.resolve(__dirname, "../portal-gateway/dist");
        const indexPath = path_1.default.resolve(buildPath, "index.html");
        if (fs_1.default.existsSync(indexPath)) {
            // Serve static assets with proper headers
            app.use("/assets", express_1.default.static(path_1.default.join(buildPath, "assets"), {
                maxAge: process.env.NODE_ENV === "production" ? "1d" : "0",
                setHeaders: (res, filePath) => {
                    if (filePath.endsWith(".js")) {
                        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
                    }
                    else if (filePath.endsWith(".css")) {
                        res.setHeader("Content-Type", "text/css; charset=utf-8");
                    }
                },
            }));
            // React app serving function
            const serveReactApp = (req, res) => {
                try {
                    let htmlContent = fs_1.default.readFileSync(indexPath, "utf8");
                    // Assets path
                    htmlContent = htmlContent
                        .replace(/src="\/assets\//g, 'src="/assets/')
                        .replace(/href="\/assets\//g, 'href="/assets/');
                    res.setHeader("Content-Type", "text/html; charset=utf-8");
                    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
                    res.send(htmlContent);
                }
                catch (error) {
                    console.error(`Error serving React portal:`, error);
                    res.status(500).json({
                        error: "Failed to serve portal",
                        details: process.env.NODE_ENV === "development"
                            ? error.message
                            : undefined,
                    });
                }
            };
            // Root route
            app.get("/", serveReactApp);
        }
        else {
            console.warn("Portal frontend not found, serving API only");
            console.warn(`Expected location: ${buildPath}`);
        }
        // Server configuration
        const HOST = process.env.HOST || "0.0.0.0";
        const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 443;
        const HTTP_PORT = Number(process.env.HTTP_PORT) || 80;
        const sslCerts = loadSSLCertificates();
        let httpsServer = null;
        // HTTPS server
        if (sslCerts && process.env.ENABLE_HTTPS !== "false") {
            httpsServer = https_1.default.createServer(sslCerts, app);
            httpsServer.listen(HTTPS_PORT, HOST, () => {
                console.log(`🔒 ZaaNet HTTPS Server (FILTER) running at https://${HOST}:${HTTPS_PORT}`);
            });
        }
        // HTTP server (always start for captive portal compatibility)
        const httpServer = http_1.default.createServer(app);
        httpServer.listen(HTTP_PORT, HOST, () => {
            console.log(`ZaaNet HTTP Server (FILTER) running at http://${HOST}:${HTTP_PORT}`);
        });
        // Graceful shutdown
        const shutdown = () => __awaiter(this, void 0, void 0, function* () {
            console.log("\n🛑 Graceful shutdown initiated...");
            // Shutdown NetworkManager
            try {
                yield networkSingleton_service_1.networkManagerSingleton;
                console.log("✅ NetworkManager shutdown complete");
            }
            catch (error) {
                console.error("❌ Error shutting down NetworkManager:", error);
            }
            const shutdownPromises = [];
            if (httpsServer) {
                shutdownPromises.push(new Promise((resolve) => {
                    httpsServer.close(() => {
                        console.log("✅ HTTPS server closed");
                        resolve();
                    });
                }));
            }
            shutdownPromises.push(new Promise((resolve) => {
                httpServer.close(() => {
                    console.log("HTTP server closed");
                    resolve();
                });
            }));
            Promise.all(shutdownPromises)
                .then(() => {
                console.log("All servers closed");
                process.exit(0);
            })
                .catch((err) => {
                console.error("Error during shutdown:", err);
                process.exit(1);
            });
            // Force exit after timeout
            setTimeout(() => {
                console.warn("⚠️ Force shutdown after timeout");
                process.exit(1);
            }, 10000);
        });
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
    });
}
startServer().catch((err) => {
    console.error("Fatal error starting server:", err);
    process.exit(1);
});
