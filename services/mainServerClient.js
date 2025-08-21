"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const mainServerClient = axios_1.default.create({
    baseURL: process.env.MAIN_SERVER_URL || 'http://localhost:3000', // Make sure this is set
    timeout: 30000,
    headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.MAIN_SERVER_API_KEY,
        'x-contract-id': process.env.CONTRACT_ID
    }
});
exports.default = mainServerClient;
