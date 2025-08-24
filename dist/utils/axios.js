"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localPayAxios = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const axios_1 = __importDefault(require("axios"));
const paystackBaseURL = "https://api.paystack.co";
const paystackSecretKey = process.env.PAYSTACK_TEST_SECRET_KEY || "";
// Axios instance for Paystack API with the base URL and headers
exports.localPayAxios = axios_1.default.create({
    baseURL: paystackBaseURL,
    timeout: 30000,
    headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
    },
});
