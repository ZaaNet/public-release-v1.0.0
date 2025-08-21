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
exports.resumeSession = exports.pauseSession = exports.connectWiFi = void 0;
const networkSingleton_service_1 = require("../services/networkSingleton.service");
const mainServerClient_1 = __importDefault(require("../services/mainServerClient"));
const connectWiFi = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        // Check network manager availability
        if (!(0, networkSingleton_service_1.isNetworkManagerReady)()) {
            res.status(503).json({
                success: false,
                error: "Network service not ready. Please try again in a moment.",
            });
            return;
        }
        // Validate request body
        const { voucherCode, deviceInfo } = req.body;
        if (!voucherCode || !deviceInfo || !deviceInfo.userIP) {
            res.status(400).json({
                success: false,
                error: "Missing required fields: voucherCode and deviceInfo.userIP are required.",
            });
            return;
        }
        // Validate deviceInfo data 
        if (!deviceInfo.userIP || !deviceInfo.userAgent) {
            res.status(400).json({
                success: false,
                error: "deviceInfo must include userIP and userAgent.",
            });
            return;
        }
        // Call main server to validate voucher and check for existing sessions
        const sessionResponse = yield mainServerClient_1.default.post('/api/portal/sessions/start', {
            voucherCode: voucherCode.trim(),
            contractId: process.env.CONTRACT_ID,
            deviceInfo: {
                userIP: deviceInfo.userIP.trim(),
                userAgent: deviceInfo.userAgent.trim(),
            },
        });
        console.log(`[PORTAL] Starting session data:`, sessionResponse.data);
        if (!sessionResponse.data.success) {
            console.warn(`[PORTAL] Session start failed: ${sessionResponse.data.error}`);
            res.status(400).json({
                success: false,
                error: sessionResponse.data.error || "Failed to start session",
            });
            return;
        }
        const sessionData = sessionResponse.data;
        // Check if this is a resumed session (already has network access)
        if (sessionData.isExistingSession) {
            console.log(`[PORTAL] Existing session found: ${sessionData.sessionId}`);
            res.json({
                success: true,
                message: "Session already active for this IP",
                data: {
                    sessionId: sessionData.sessionId,
                    userIP: deviceInfo.userIP.trim(),
                    duration: sessionData.duration,
                    contractId: sessionData.contractId,
                    remainingTime: sessionData.remainingTime,
                    isExisting: true
                },
            });
            return;
        }
        // For new sessions, we need to grant network access
        try {
            const networkManager = (0, networkSingleton_service_1.getNetworkManager)();
            console.log(`[PORTAL] Granting network access for session ${sessionData.sessionId}`);
            const whitelistResult = yield networkManager.whitelistIP(sessionData.sessionId, deviceInfo.userIP.trim());
            if (!whitelistResult.success) {
                // Notify main server that network setup failed
                yield mainServerClient_1.default.post('/api/portal/sessions/network-failed', {
                    userIP: deviceInfo.userIP.trim(),
                    sessionId: sessionData.sessionId,
                    contractId: process.env.CONTRACT_ID,
                    userAgent: deviceInfo.userAgent.trim(),
                });
                res.status(500).json({
                    success: false,
                    error: "Failed to grant network access",
                    details: whitelistResult.error,
                });
                return;
            }
            console.log(`[PORTAL] Successfully whitelisted IP ${deviceInfo.userIP.trim()} for session ${sessionData.sessionId}`);
            // Notify main server that network access was granted successfully
            yield mainServerClient_1.default.post('/api/portal/sessions/network-granted', {
                voucherCode: voucherCode.trim(),
                sessionId: sessionData.sessionId,
                userIP: deviceInfo.userIP.trim(),
                contractId: process.env.CONTRACT_ID,
                userAgent: deviceInfo.userAgent.trim(),
            });
            console.log(`[PORTAL] Successfully granted network access for session ${sessionData.sessionId}`);
            // Success response - user gets immediate internet access
            res.json({
                success: true,
                message: "Internet access granted successfully!",
                data: {
                    sessionId: sessionData.sessionId,
                    userIP: deviceInfo.userIP.trim(),
                    duration: sessionData.duration,
                    contractId: sessionData.contractId,
                    voucherAmount: sessionData.voucherAmount,
                    voucherCurrency: sessionData.voucherCurrency,
                    usdValue: sessionData.usdValue,
                    remainingTime: sessionData.remainingTime,
                    note: "Session is now active"
                },
            });
        }
        catch (networkError) {
            console.error("[PORTAL] Network access error:", networkError);
            // Notify main server about network failure so it can clean up
            try {
                yield mainServerClient_1.default.post('/api/portal/sessions/network-failed', {
                    sessionId: sessionData.sessionId,
                    error: networkError instanceof Error ? networkError.message : 'Unknown network error',
                    contractId: process.env.CONTRACT_ID
                });
            }
            catch (notifyError) {
                console.error("[PORTAL] Failed to notify main server of network error:", notifyError);
            }
            res.status(500).json({
                success: false,
                error: "Network access configuration failed. Session has been cancelled.",
            });
        }
    }
    catch (error) {
        console.error("[PORTAL] Session start error:", error);
        // Handle different types of main server errors
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            res.status(503).json({
                success: false,
                error: "Main server is not responding. Please try again.",
            });
        }
        else if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 401) {
            res.status(500).json({
                success: false,
                error: "Portal authentication failed. Please contact support.",
            });
        }
        else if (((_b = error.response) === null || _b === void 0 ? void 0 : _b.status) === 429) {
            res.status(429).json({
                success: false,
                error: "Too many requests. Please wait before trying again.",
            });
        }
        else {
            res.status(500).json(Object.assign({ success: false, error: "Failed to start session. Please try again." }, (process.env.NODE_ENV === "development" && {
                details: error.message || "Unknown error",
            })));
        }
    }
});
exports.connectWiFi = connectWiFi;
/**
 * Pause an active session
 * Moves session to paused state and preserves remaining time
 */
const pauseSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Check if NetworkManager is ready
        if (!(0, networkSingleton_service_1.isNetworkManagerReady)()) {
            res.status(503).json({
                success: false,
                message: 'Network service not ready',
                error: 'Please try again in a moment'
            });
            return;
        }
        const { sessionId, userIP } = req.body;
        if (!sessionId || !userIP) {
            res.status(400).json({
                success: false,
                message: 'Session ID and user IP are required',
                error: 'Missing required fields'
            });
            return;
        }
        // Notify main server to pause the session
        const pauseResponse = yield mainServerClient_1.default.post('/api/portal/sessions/pause', {
            sessionId,
            userIP,
            contractId: process.env.CONTRACT_ID,
        });
        if (pauseResponse.data.success) {
            // Revoke network access for the paused session
            if ((0, networkSingleton_service_1.isNetworkManagerReady)()) {
                try {
                    const networkManager = (0, networkSingleton_service_1.getNetworkManager)();
                    yield networkManager.revokeIPAccess(userIP, sessionId);
                    console.log(`[PORTAL] Revoked network access for session ${sessionId}`);
                }
                catch (networkError) {
                    console.error(`[PORTAL] Failed to revoke network access: ${networkError}`);
                }
            }
            res.json({
                success: true,
                message: "Session paused successfully",
                data: pauseResponse.data.data
            });
        }
        else {
            res.status(400).json({
                success: false,
                error: pauseResponse.data.error || "Failed to pause session",
            });
        }
    }
    catch (error) {
        console.error('Error pausing session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to pause session',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.pauseSession = pauseSession;
/**
 * Resume a paused session
 * Restores session to active state with remaining time
 */
const resumeSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Check if NetworkManager is ready
        if (!(0, networkSingleton_service_1.isNetworkManagerReady)()) {
            res.status(503).json({
                success: false,
                message: 'Network service not ready',
                error: 'Please try again in a moment'
            });
            return;
        }
        const { voucherCode, userAgent, userIP } = req.body;
        if (!voucherCode || !userIP) {
            res.status(400).json({
                success: false,
                message: 'Voucher code and user IP are required',
                error: 'Missing required fields'
            });
            return;
        }
        // Call main server to resume session
        const resumeResponse = yield mainServerClient_1.default.post('/api/portal/sessions/resume', {
            voucherCode: voucherCode.trim(),
            userIP: userIP.trim(),
            userAgent: userAgent === null || userAgent === void 0 ? void 0 : userAgent.trim(),
            contractId: process.env.CONTRACT_ID,
        });
        if (!resumeResponse.data.success) {
            res.status(400).json({
                success: false,
                error: resumeResponse.data.error || "Failed to resume session",
            });
            return;
        }
        const sessionData = resumeResponse.data;
        // Grant network access for resumed session
        try {
            const networkManager = (0, networkSingleton_service_1.getNetworkManager)();
            const whitelistResult = yield networkManager.whitelistIP(sessionData.sessionId, userIP.trim());
            if (!whitelistResult.success) {
                console.error(`[PORTAL] Failed to whitelist IP ${userIP.trim()}:`, whitelistResult.error);
                // Rollback: remove the whitelisted IP
                yield mainServerClient_1.default.post('/api/portal/sessions/network-failed', {
                    userIP: userIP.trim(),
                    sessionId: sessionData.sessionId,
                    contractId: process.env.CONTRACT_ID,
                    userAgent: userAgent === null || userAgent === void 0 ? void 0 : userAgent.trim(),
                    resuming: true
                });
                res.status(500).json({
                    success: false,
                    error: "Failed to restore network access",
                });
                return;
            }
            res.json({
                success: true,
                message: "Session resumed successfully",
                data: sessionData
            });
        }
        catch (error) {
            console.error('Error resuming session:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to resume session',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error resuming session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resume session',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.resumeSession = resumeSession;
