"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const manageSession_controllers_1 = require("../controllers/manageSession.controllers");
const manageSessionRouter = express_1.default.Router();
manageSessionRouter.post("/session-info", manageSession_controllers_1.getActiveSessionInfo);
manageSessionRouter.post("/live-metrics", manageSession_controllers_1.getSessionAnalytics);
exports.default = manageSessionRouter;
