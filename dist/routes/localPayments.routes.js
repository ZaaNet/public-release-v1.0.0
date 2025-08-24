"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const localPayment_controllers_1 = __importDefault(require("../controllers/localPayment.controllers"));
const paymentRouter = express_1.default.Router();
// Initialize transaction (Step 1)
paymentRouter.post('/initialize', (req, res) => {
    localPayment_controllers_1.default.initializeTransaction(req, res);
});
// Verify transaction (Step 3)
paymentRouter.get('/verify/:reference/:userIP', (req, res) => {
    localPayment_controllers_1.default.verifyTransaction(req, res);
});
paymentRouter.post('/cancel', (req, res) => {
    localPayment_controllers_1.default.cancelTransaction(req, res);
});
exports.default = paymentRouter;
