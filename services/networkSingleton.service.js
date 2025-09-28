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
exports.networkManagerSingleton = void 0;
exports.getNetworkManager = getNetworkManager;
exports.isNetworkManagerReady = isNetworkManagerReady;
const centralManager_service_1 = require("./centralManager.service");
class NetworkManagerSingleton {
    constructor() {
        this.networkManager = null;
        this.isInitialized = false;
    }
    static getInstance() {
        if (!NetworkManagerSingleton.instance) {
            NetworkManagerSingleton.instance = new NetworkManagerSingleton();
        }
        return NetworkManagerSingleton.instance;
    }
    initialize(contractId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isInitialized) {
                return;
            }
            this.networkManager = new centralManager_service_1.NetworkManager(contractId);
            yield this.networkManager.initialize();
            this.isInitialized = true;
        });
    }
    getNetworkManager() {
        if (!this.networkManager || !this.isInitialized) {
            throw new Error('NetworkManager not initialized. Call initialize() first.');
        }
        return this.networkManager;
    }
    isReady() {
        return this.isInitialized && this.networkManager !== null;
    }
}
// Export the singleton instance and helper functions
exports.networkManagerSingleton = NetworkManagerSingleton.getInstance();
function getNetworkManager() {
    return exports.networkManagerSingleton.getNetworkManager();
}
function isNetworkManagerReady() {
    return exports.networkManagerSingleton.isReady();
}
