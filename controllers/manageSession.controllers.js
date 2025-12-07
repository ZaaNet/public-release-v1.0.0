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
exports.getSessionAnalytics = exports.getActiveSessionInfo = void 0;
const mainServerClient_1 = __importDefault(require("../services/mainServerClient"));
/**
 * Get basic session info for timing calculations
 * Returns session metadata from Session model
 */
const getActiveSessionInfo = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userIP, sessionId, contractId } = req.body;
        // Add validation for required fields
        if (!userIP || !sessionId || !contractId) {
            res.status(400).json({
                success: false,
                message: 'Missing required fields',
                error: 'userIP, sessionId, and contractId are required'
            });
            return;
        }
        // Call main server to get session info
        const response = yield mainServerClient_1.default.post('/portal/sessions/info', {
            userIP,
            sessionId,
            contractId
        });
        if (response.data.success) {
            res.status(200).json(Object.assign({ success: true }, response.data.session));
        }
        else {
            res.status(404).json({
                success: false,
                message: response.data.message || 'Session not found',
                error: response.data.error || 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error fetching session info:', {
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            body: req.body,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({
            success: false,
            message: 'Failed to fetch session info',
            error: process.env.NODE_ENV === 'development'
                ? (error instanceof Error ? error.message : 'Unknown error')
                : 'Internal server error'
        });
    }
});
exports.getActiveSessionInfo = getActiveSessionInfo;
const getSessionAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userIP, sessionId, contractId } = req.body;
        // Call main server to get session analytics
        const response = yield mainServerClient_1.default.post('/portal/metrics', {
            userIP,
            sessionId,
            contractId
        });
        if (response.data.success) {
            res.status(200).json(Object.assign({ success: true }, response.data));
        }
        else {
            res.status(404).json({
                success: false,
                message: response.data.message || 'Session not found',
                error: response.data.error || 'Unknown error'
            });
        }
    }
    catch (error) {
        console.error('Error fetching session analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch session analytics',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.getSessionAnalytics = getSessionAnalytics;
