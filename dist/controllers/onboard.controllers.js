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
exports.getUserRating = exports.rateNetwork = exports.getNetworkRating = exports.extendSession = exports.getNetworkInfo = exports.checkSessionAuth = exports.fetchDeviceIp = exports.validateVoucher = void 0;
const mainServerClient_1 = __importDefault(require("../services/mainServerClient"));
const validateVoucher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { voucherCode } = req.body;
    try {
        // Basic input validation
        if (!voucherCode || typeof voucherCode !== "string") {
            res.status(400).json({
                isValid: false,
                error: "Voucher code is required and must be a string",
            });
            return;
        }
        // Call main server to validate voucher
        const response = yield mainServerClient_1.default.post("/api/portal/sessions/validate-voucher", {
            voucherCode
        });
        console.log("Validation response:", response.data);
        if (response.data.isValid) {
            res.json(Object.assign({}, response.data));
        }
        else {
            res.status(400).json({
                isValid: false,
                error: response.data.error || "Invalid voucher",
            });
        }
    }
    catch (error) {
        console.error("Voucher validation error:", {
            error: error instanceof Error ? error.message : String(error),
            voucherCode: voucherCode,
            timestamp: new Date().toISOString(),
        });
        res.status(500).json({
            isValid: false,
            error: "Internal server error. Please try again later.",
        });
    }
});
exports.validateVoucher = validateVoucher;
const fetchDeviceIp = (req, res) => {
    const guestIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const ip = typeof guestIp === "string" && guestIp.startsWith("::ffff:")
        ? guestIp.replace("::ffff:", "")
        : guestIp;
    const userAgent = req.headers["user-agent"];
    // Placeholder to implement MAC address lookup later
    const macAddress = "";
    res.json({ userIP: ip, userAgent, macAddress });
};
exports.fetchDeviceIp = fetchDeviceIp;
const checkSessionAuth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userIP } = req.body;
        // Input validation
        if (!(userIP === null || userIP === void 0 ? void 0 : userIP.trim())) {
            res.status(400).json({
                valid: false,
                error: "User IP address is required",
            });
            return;
        }
        // Call main server to check session auth
        const response = yield mainServerClient_1.default.post("/api/portal/sessions/session-auth", {
            userIP: userIP.trim(),
            contractId: process.env.CONTRACT_ID,
        });
        if (response.data.valid) {
            res.status(200).json(response.data);
        }
        else {
            res.status(401).json({
                valid: false,
                error: response.data.error || "Session authentication failed",
            });
        }
    }
    catch (error) {
        console.error("Session authentication check failed:", error);
        // Generic error
        res.status(500).json({
            valid: false,
            error: "Internal server error",
        });
    }
});
exports.checkSessionAuth = checkSessionAuth;
const getNetworkInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Call main server to get network info
        const response = yield mainServerClient_1.default.get(`/api/portal/network/info/${process.env.CONTRACT_ID}`);
        if (response.data.success) {
            res.status(200).json({
                success: true,
                data: response.data.networkData
            });
        }
        else {
            res.status(404).json({
                success: false,
                error: response.data.error || "Network not found"
            });
        }
    }
    catch (error) {
        console.error("Failed to get network info:", error);
        res.status(500).json({
            success: false,
            error: "Failed to get network info",
        });
    }
});
exports.getNetworkInfo = getNetworkInfo;
const extendSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userIP, sessionId, contractId, sessionPerHour, voucherCode } = req.body;
        // Validate required fields
        if (!userIP || !sessionId || !contractId || !voucherCode) {
            res.status(400).json({
                success: false,
                message: 'Missing required fields',
                error: 'userIP, sessionId, contractId, and voucherCode are required'
            });
            return;
        }
        // Call main server to extend session
        const response = yield mainServerClient_1.default.post('/api/portal/sessions/extend-session', {
            userIP,
            sessionId,
            contractId,
            sessionPerHour,
            voucherCode
        });
        console.log("Extend session response:", response.data);
        if (response.data.success) {
            res.status(200).json(Object.assign({ success: true, message: 'Session extended successfully' }, response.data));
        }
        else {
            res.status(400).json({
                success: false,
                message: response.data.message || 'Failed to extend session',
                error: response.data.error || 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to extend session',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.extendSession = extendSession;
const getNetworkRating = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { contractId } = req.params;
        // Validate required parameters
        if (!contractId) {
            res.status(400).json({
                success: false,
                message: 'Network ID is required'
            });
            return;
        }
        // Call main server to get network rating
        const response = yield mainServerClient_1.default.get(`/api/portal/network/ratings/${contractId}`);
        if (response.data.success) {
            res.status(200).json(Object.assign({ success: true }, response.data.ratingData));
        }
        else {
            res.status(404).json({
                success: false,
                message: response.data.message || 'Network not found',
                error: response.data.error || 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error fetching user rating:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.getNetworkRating = getNetworkRating;
const rateNetwork = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { contractId, userIP, rating, comment } = req.body;
        // Validate required fields
        if (!contractId || !userIP || typeof rating !== 'number') {
            res.status(400).json({
                success: false,
                message: 'Network ID, user IP, and rating are required'
            });
            return;
        }
        // Call main server to rate network
        const response = yield mainServerClient_1.default.post('/api/portal/network/rate-network', {
            contractId,
            userIP,
            rating,
            comment
        });
        if (response.data.success) {
            res.status(200).json({
                data: response.data.data
            });
        }
        else {
            res.status(400).json({
                success: false,
                message: response.data.message || 'Failed to rate network',
                error: response.data.error || 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error rating network:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.rateNetwork = rateNetwork;
const getUserRating = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { contractId, userIP } = req.params;
        // Validate required parameters
        if (!contractId) {
            res.status(400).json({
                success: false,
                message: 'Contract ID is required'
            });
            return;
        }
        if (!userIP) {
            res.status(400).json({
                success: false,
                message: 'User IP is required'
            });
            return;
        }
        // Call main server to get user rating
        const response = yield mainServerClient_1.default.get(`/api/portal/network/user-ratings/${contractId}/${userIP}`);
        if (response.data.success) {
            res.status(200).json(Object.assign({ success: true }, response.data.ratingData));
        }
        else {
            res.status(404).json({
                success: false,
                message: response.data.message || 'User rating not found',
                error: response.data.error || 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error fetching user rating:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});
exports.getUserRating = getUserRating;
