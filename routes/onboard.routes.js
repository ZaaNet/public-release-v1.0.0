"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const onboard_controllers_1 = require("../controllers/onboard.controllers");
const connectWiFi_controller_1 = require("../controllers/connectWiFi.controller");
const onboardRouter = express_1.default.Router();
onboardRouter.post("/validate", onboard_controllers_1.validateVoucher);
// Start a new session
onboardRouter.post("/start", connectWiFi_controller_1.connectWiFi);
// Check session status based on JWT token
onboardRouter.post("/session-auth", onboard_controllers_1.checkSessionAuth);
onboardRouter.get("/network", onboard_controllers_1.getNetworkInfo);
onboardRouter.get("/device-info", onboard_controllers_1.fetchDeviceIp);
onboardRouter.post("/extend-session", onboard_controllers_1.extendSession);
onboardRouter.get("/network-rating/:contractId", onboard_controllers_1.getNetworkRating);
onboardRouter.get("/user-rating/:contractId/:userIP", onboard_controllers_1.getUserRating);
onboardRouter.post("/rate-network", onboard_controllers_1.rateNetwork);
onboardRouter.post("/pause", connectWiFi_controller_1.pauseSession);
onboardRouter.post("/resume", connectWiFi_controller_1.resumeSession);
exports.default = onboardRouter;
