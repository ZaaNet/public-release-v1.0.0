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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkManager = void 0;
const FirewallManager_1 = require("./FirewallManager");
class NetworkManager {
    constructor(contractId) {
        this.isInitialized = false;
        this.contractId = contractId;
        this.firewallManager = new FirewallManager_1.FirewallManager();
    }
    initialize() {
        return __awaiter(this, arguments, void 0, function* (restoreState = true) {
            if (this.isInitialized)
                return;
            yield this.firewallManager.initialize(restoreState); // Pass restore flag
            this.isInitialized = true;
        });
    }
    // Firewall methods
    whitelistIP(sessionId, userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            const firewallResult = yield this.firewallManager.whitelistIP(sessionId, userIP);
            return firewallResult;
        });
    }
    revokeIPAccess(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.firewallManager.revokeIPAccess(userIP, sessionId);
        });
    }
    // Getters
    getNetworkId() {
        return this.contractId;
    }
    getFirewallManager() {
        return this.firewallManager;
    }
    // Shutdown
    shutdown() {
        this.firewallManager.shutdown();
        this.isInitialized = false;
    }
}
exports.NetworkManager = NetworkManager;
