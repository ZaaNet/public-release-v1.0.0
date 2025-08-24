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
const temporalAccessMonitor_service_1 = require("../services/temporalAccessMonitor.service");
const mainServerClient_1 = __importDefault(require("../services/mainServerClient"));
class LocalPaymentController {
    constructor() {
        // Initialize TemporalAccessMonitor with database
        this.accessMonitor = new temporalAccessMonitor_service_1.TemporalAccessMonitor();
    }
    // Initialize transaction (Step 1 of Paystack flow)
    initializeTransaction(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                const { email, amount, userIP } = req.body;
                // Validate required fields
                if (!email || !amount) {
                    res.status(400).json({
                        success: false,
                        message: "Email and amount are required",
                    });
                    return;
                }
                // Grant monitored internet access
                yield this.accessMonitor.grantMonitoredAccess(userIP);
                const response = yield mainServerClient_1.default.post('/api/portal/payments/initialize', {
                    email,
                    amount,
                    userIP,
                    contractId: process.env.CONTRACT_ID
                });
                if (response.data && response.data.success) {
                    res.json(response.data);
                }
                else {
                    res.status(400).json(response.data);
                    // Revoke access if initialization fails
                    yield this.accessMonitor.revokeTemporaryAccess(userIP);
                    console.error("Payment initialization failed:", response.data.message);
                    return;
                }
            }
            catch (error) {
                // Revoke access on error
                yield this.accessMonitor.revokeTemporaryAccess(req.body.userIP);
                console.error("Transaction initialization error:", error);
                res.status(500).json({
                    success: false,
                    message: ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.message) || "Transaction initialization failed",
                });
                return;
            }
        });
    }
    // Verify transaction - Only retrieves, doesn't create voucher
    verifyTransaction(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            try {
                const { reference, userIP } = req.params;
                // Validate required parameters
                if (!reference) {
                    res.status(400).json({
                        success: false,
                        message: "Transaction reference is required",
                    });
                    return;
                }
                if (!userIP) {
                    res.status(400).json({
                        success: false,
                        message: "User IP address is required",
                    });
                    return;
                }
                console.log(`[PORTAL] Verifying transaction ${reference} for IP ${userIP}`);
                // Call main server to verify payment instead of Paystack directly
                const response = yield mainServerClient_1.default.get(`/api/portal/payments/verify/${reference}`, {
                    params: {
                        userIP: userIP,
                        contractId: process.env.CONTRACT_ID
                    }
                });
                // Always revoke temporary access after verification attempt
                yield this.accessMonitor.revokeTemporaryAccess(userIP);
                console.log(`[PORTAL] Revoked temporary access for IP ${userIP}`);
                console.log(`[PORTAL] Verification response for ${reference}:`, response.data);
                if (response.data) {
                    const transactionData = response.data;
                    res.json({
                        success: true,
                        reference: transactionData.reference,
                        status: transactionData.status,
                        amount: transactionData.amount,
                        gateway_response: transactionData.gateway_response,
                        paid_at: transactionData.paid_at,
                        voucher_code: transactionData.voucher_code || "",
                        channel: transactionData.channel,
                        message: "Transaction verification completed",
                    });
                    console.log(`[PORTAL] Verification successful for ${reference}:`, {
                        status: transactionData.status,
                        hasVoucher: !!transactionData.voucher_code
                    });
                }
                else {
                    // Main server returned error
                    const errorMessage = response.data.error || "Transaction verification failed";
                    console.warn(`[PORTAL] Verification failed for ${reference}: ${errorMessage}`);
                    res.status(400).json({
                        success: false,
                        message: errorMessage,
                    });
                }
            }
            catch (error) {
                // Ensure we always revoke access on error
                if ((_a = req === null || req === void 0 ? void 0 : req.params) === null || _a === void 0 ? void 0 : _a.userIP) {
                    try {
                        yield this.accessMonitor.revokeTemporaryAccess(req.params.userIP);
                        console.log(`[PORTAL] Revoked temporary access for IP ${req.params.userIP} due to error`);
                    }
                    catch (revokeError) {
                        console.error(`[PORTAL] Failed to revoke access for IP ${req.params.userIP}:`, revokeError);
                    }
                }
                console.error(`[PORTAL] Transaction verification error for ${(_b = req === null || req === void 0 ? void 0 : req.params) === null || _b === void 0 ? void 0 : _b.reference}:`, {
                    error: error.message,
                    status: (_c = error.response) === null || _c === void 0 ? void 0 : _c.status,
                    data: (_d = error.response) === null || _d === void 0 ? void 0 : _d.data
                });
                // Handle different types of errors
                if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                    res.status(408).json({
                        success: false,
                        message: "Main server is not responding. Please try again.",
                    });
                }
                else if (((_e = error.response) === null || _e === void 0 ? void 0 : _e.status) === 401) {
                    res.status(500).json({
                        success: false,
                        message: "Portal authentication failed. Please contact support.",
                    });
                }
                else if (((_f = error.response) === null || _f === void 0 ? void 0 : _f.status) === 404) {
                    res.status(404).json({
                        success: false,
                        message: "Transaction not found or expired.",
                    });
                }
                else {
                    res.status(500).json({
                        success: false,
                        message: "Transaction verification failed. Please try again.",
                    });
                }
            }
        });
    }
    // Cancel transaction - Calls main server instead of handling locally
    cancelTransaction(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            try {
                const { reference, userIP } = req.body;
                // Validate required parameters
                if (!reference || !userIP) {
                    res.status(400).json({
                        success: false,
                        message: "Reference and userIP are required"
                    });
                    return;
                }
                console.log(`[PORTAL] Cancelling transaction ${reference} for IP ${userIP}`);
                // Call main server to cancel the transaction
                const response = yield mainServerClient_1.default.post('/api/portal/payments/cancel', {
                    reference,
                    userIP,
                    contractId: process.env.CONTRACT_ID,
                    cancelledBy: 'portal',
                    reason: 'User cancelled payment'
                });
                // Always revoke temporary access when cancelling
                try {
                    yield this.accessMonitor.revokeTemporaryAccess(userIP);
                    console.log(`[PORTAL] Revoked temporary access for IP ${userIP} due to cancellation`);
                }
                catch (revokeError) {
                    console.error(`[PORTAL] Failed to revoke access for IP ${userIP}:`, revokeError);
                    // Continue even if revoke fails - user shouldn't be penalized
                }
                if (response.data && response.data.success) {
                    res.json({
                        success: true,
                        message: "Payment cancelled successfully"
                    });
                    console.log(`[PORTAL] Successfully cancelled transaction ${reference}`);
                }
                else {
                    // Main server returned error
                    const errorMessage = response.data.error || "Failed to cancel transaction";
                    console.warn(`[PORTAL] Failed to cancel transaction ${reference}: ${errorMessage}`);
                    res.status(400).json({
                        success: false,
                        message: errorMessage
                    });
                }
            }
            catch (error) {
                // Ensure we always try to revoke access on error
                if ((_a = req === null || req === void 0 ? void 0 : req.body) === null || _a === void 0 ? void 0 : _a.userIP) {
                    try {
                        yield this.accessMonitor.revokeTemporaryAccess(req.body.userIP);
                        console.log(`[PORTAL] Revoked temporary access for IP ${req.body.userIP} due to error`);
                    }
                    catch (revokeError) {
                        console.error(`[PORTAL] Failed to revoke access for IP ${req.body.userIP}:`, revokeError);
                    }
                }
                console.error(`[PORTAL] Cancel transaction error for ${(_b = req === null || req === void 0 ? void 0 : req.body) === null || _b === void 0 ? void 0 : _b.reference}:`, {
                    error: error.message,
                    status: (_c = error.response) === null || _c === void 0 ? void 0 : _c.status,
                    data: (_d = error.response) === null || _d === void 0 ? void 0 : _d.data
                });
                // Handle different types of errors
                if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                    res.status(408).json({
                        success: false,
                        message: "Main server is not responding. Payment may still be active."
                    });
                }
                else if (((_e = error.response) === null || _e === void 0 ? void 0 : _e.status) === 401) {
                    res.status(500).json({
                        success: false,
                        message: "Portal authentication failed. Please contact support."
                    });
                }
                else if (((_f = error.response) === null || _f === void 0 ? void 0 : _f.status) === 404) {
                    res.status(404).json({
                        success: false,
                        message: "Transaction not found or already processed."
                    });
                }
                else {
                    res.status(500).json({
                        success: false,
                        message: "Failed to cancel transaction. Please try again."
                    });
                }
            }
        });
    }
}
exports.default = new LocalPaymentController();
