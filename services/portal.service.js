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
exports.FirewallManager = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const node_cron_1 = __importDefault(require("node-cron"));
const mainServerClient_1 = __importDefault(require("./mainServerClient"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class FirewallManager {
    constructor() {
        this.isInitialized = false;
        this.cleanupJob = null;
        this.usageUpdateJob = null;
        this.contractId = process.env.CONTRACT_ID || '';
        this.config = {
            authChainName: "ZAANET_AUTH_USERS",
            blockChainName: "ZAANET_BLOCKED",
            enableLogging: true,
        };
    }
    initialize() {
        return __awaiter(this, arguments, void 0, function* (restoreState = true) {
            if (this.isInitialized) {
                return;
            }
            try {
                // Verify iptables is available
                yield this.verifyIptables();
                // Create required chains
                yield this.createChains();
                // Restore previous session state if requested
                if (restoreState) {
                    yield this.restoreSessionState();
                }
                // Start background tasks
                this.startBackgroundTasks();
                this.isInitialized = true;
            }
            catch (error) {
                console.error(`Failed to initialize: ${error}`);
                throw error;
            }
        });
    }
    /**
     * Add IP to whitelist and start tracking session
     */
    whitelistIP(sessionId, userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.isValidIP(userIP)) {
                    return {
                        success: false,
                        error: "Invalid IP address"
                    };
                }
                // Add firewall rule
                const rule = {
                    userIP,
                    action: "ACCEPT",
                    comment: `${this.contractId}_${sessionId}`,
                };
                yield this.addFirewallRule(rule);
                // Add traffic counting rules
                yield this.addTrafficCountingRules(userIP, sessionId);
                return { success: true, sessionId };
            }
            catch (error) {
                console.error(`Error whitelisting IP ${userIP}:`, error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                };
            }
        });
    }
    /**
     * Remove IP from whitelist and cleanup
     */
    revokeIPAccess(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Remove firewall rules
                yield this.removeFirewallRule(userIP, this.config.authChainName);
                yield this.removeTrafficCountingRules(sessionId);
                return { success: true };
            }
            catch (error) {
                console.error(`Error revoking IP ${userIP}:`, error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                };
            }
        });
    }
    /**
     * Update session time usage for all active sessions
     */
    // It reduces remaining time and updates lastTimeUpdate to track time used.
    updateSessionTimeUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get active sessions from main server
                const activeSessions = yield this.getActiveSessionsFromServer();
                if (activeSessions.length === 0) {
                    return { updated: 0, errors: 0 };
                }
                const now = new Date();
                const sessionUpdates = [];
                for (const session of activeSessions) {
                    const lastUpdate = session.lastTimeUpdate || session.startTime;
                    const secondsElapsed = Math.floor((now.getTime() - new Date(lastUpdate).getTime()) / 1000);
                    if (secondsElapsed <= 0)
                        continue;
                    const usedSeconds = Math.min(secondsElapsed, 60);
                    const newRemainingTime = Math.max(0, session.remainingTimeSecs - usedSeconds);
                    const newActualDuration = (session.actualDurationSeconds || 0) + usedSeconds;
                    sessionUpdates.push({
                        sessionId: session.sessionId,
                        lastTimeUpdate: now,
                        remainingTimeSecs: newRemainingTime,
                        actualDurationSeconds: newActualDuration,
                    });
                }
                if (sessionUpdates.length === 0) {
                    return { updated: 0, errors: 0 };
                }
                // Send updates to main server
                const result = yield this.sendTimeUpdatesToServer(sessionUpdates);
                return result;
            }
            catch (error) {
                console.error(`Error updating session usage:`, error);
                return { updated: 0, errors: 1 };
            }
        });
    }
    /**
     * Clean up expired sessions
     */
    cleanupExpiredSessions() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get expired sessions from main server
                const expiredSessions = yield this.getExpiredSessionsFromServer();
                if (expiredSessions.length === 0) {
                    return { cleaned: 0, errors: 0 };
                }
                let cleaned = 0;
                let errors = 0;
                const sessionsToExpire = [];
                for (const session of expiredSessions) {
                    try {
                        if (session.userIP) {
                            // Call the method directly instead of using a callback
                            const result = yield this.revokeIPAccess(session.userIP, session.sessionId);
                            if (result.success) {
                                cleaned++;
                                sessionsToExpire.push(session.sessionId);
                            }
                            else {
                                errors++;
                            }
                        }
                    }
                    catch (error) {
                        console.error(`Failed to cleanup session ${session.sessionId}:`, error);
                        errors++;
                    }
                }
                // Send expired session updates to main server
                if (sessionsToExpire.length > 0) {
                    yield this.markSessionsExpiredOnServer(sessionsToExpire);
                }
                return { cleaned, errors };
            }
            catch (error) {
                console.error(`Cleanup failed:`, error);
                return { cleaned: 0, errors: 1 };
            }
        });
    }
    getActiveSessionsFromServer() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield mainServerClient_1.default.get(`/api/portal/sessions/active?contractId=${this.contractId}`);
            const data = response.data;
            return data.success ? data.data.sessions : [];
        });
    }
    getExpiredSessionsFromServer() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield mainServerClient_1.default.get(`/api/portal/sessions/expired?contractId=${this.contractId}`);
            const data = response.data;
            return data.success ? data.data.sessions : [];
        });
    }
    sendTimeUpdatesToServer(sessionUpdates) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield mainServerClient_1.default.put(`/api/portal/sessions/update-time`, { sessionUpdates });
            const data = yield response.data;
            return {
                updated: data.success ? data.data.successCount : 0,
                errors: data.success ? data.data.errorCount : sessionUpdates.length
            };
        });
    }
    markSessionsExpiredOnServer(sessionIds) {
        return __awaiter(this, void 0, void 0, function* () {
            yield mainServerClient_1.default.put(`/api/portal/sessions/mark-expired`, {
                sessionIds
            });
        });
    }
    /**
     * Restore session state from database after server restart
     */
    restoreSessionState() {
        return __awaiter(this, void 0, void 0, function* () {
            let restored = 0;
            let expired = 0;
            let errors = 0;
            try {
                // **FIRST: Nuclear cleanup of ALL existing rules for this network**
                yield this.nuclearCleanupAllRules();
                // Verify chains exist
                yield this.createChains();
                // Get all sessions for this network from main server
                const sessions = yield this.getActiveSessionsFromServer();
                const validIPs = new Set();
                for (const session of sessions) {
                    try {
                        const { sessionId, remainingTimeSecs, userIP } = session;
                        if (!userIP || !this.isValidIP(userIP)) {
                            errors++;
                            continue;
                        }
                        validIPs.add(userIP);
                        // **Create fresh rules (these will start with 0 counters)**
                        const whitelisting = this.whitelistIP(sessionId, userIP);
                        if (!whitelisting) {
                            console.error(`FAILED to restore session ${sessionId} for IP ${userIP}`);
                            errors++;
                            continue;
                        }
                        restored++;
                        // Small delay to avoid overwhelming the system
                        yield new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    catch (error) {
                        console.error(`Error restoring session ${session.sessionId}:`, error);
                        errors++;
                    }
                }
                // Cleanup stale firewall rules
                yield this.cleanupStaleRules(validIPs);
                return { restored, expired, errors };
            }
            catch (error) {
                console.error(`Session restoration failed:`, error);
                return { restored, expired, errors: errors + 1 };
            }
        });
    }
    nuclearCleanupAllRules() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get all rule numbers that contain our network ID
                const listCmd = `sudo /sbin/iptables -L FORWARD -n --line-numbers | grep "_${this.contractId}_" | awk '{print $1}' | sort -nr`;
                yield execAsync(listCmd); // Get rule numbers in reverse order
            }
            catch (error) {
                console.error("Nuclear cleanup failed:", error);
            }
        });
    }
    /**
     * Cleanup stale firewall rules that don't match valid IPs
     */
    cleanupStaleRules(validIPs) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get all rules from auth chain
                const { stdout } = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n --line-numbers`);
                const lines = stdout.split("\n");
                const toRemove = [];
                for (const line of lines) {
                    // Match rule format: line_number ACCEPT all -- source_ip destination
                    const match = line.match(/^ *(\d+) +ACCEPT +all +-- +([0-9.]+)/);
                    if (match) {
                        const [, lineNumStr, ip] = match;
                        if (!validIPs.has(ip)) {
                            toRemove.push({ line: parseInt(lineNumStr), ip });
                        }
                    }
                }
                // Remove stale rules (reverse order to maintain line numbers)
                for (const rule of toRemove.reverse()) {
                    try {
                        yield execAsync(`sudo /sbin/iptables -D ${this.config.authChainName} ${rule.line}`);
                    }
                    catch (error) {
                        console.error(`Could not remove stale rule for IP ${rule.ip}:`, error);
                    }
                }
            }
            catch (error) {
                console.error(`Failed to cleanup stale rules:`, error);
            }
        });
    }
    /**
     * Graceful shutdown
     */
    shutdown() {
        this.stopBackgroundTasks();
        this.isInitialized = false;
    }
    // Private helper methods
    verifyIptables() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield execAsync("sudo /sbin/iptables --version");
            }
            catch (error) {
                throw new Error("iptables not available or not accessible");
            }
        });
    }
    createChains() {
        return __awaiter(this, void 0, void 0, function* () {
            const chains = [this.config.authChainName, this.config.blockChainName];
            for (const chain of chains) {
                try {
                    // Check if chain exists
                    yield execAsync(`sudo /sbin/iptables -L ${chain} -n`);
                }
                catch (error) {
                    // Create chain if it doesn't exist
                    yield execAsync(`sudo /sbin/iptables -N ${chain}`);
                    yield execAsync(`sudo /sbin/iptables -I FORWARD -j ${chain}`);
                }
            }
        });
    }
    addFirewallRule(rule, chain) {
        return __awaiter(this, void 0, void 0, function* () {
            const targetChain = chain || this.config.authChainName;
            const cmd = `sudo /sbin/iptables -A ${targetChain} -s ${rule.userIP} -m comment --comment "${rule.comment}" -j ${rule.action}`;
            yield execAsync(cmd);
        });
    }
    removeFirewallRule(ip, chain) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get rule number for this IP
                const { stdout } = yield execAsync(`sudo /sbin/iptables -L ${chain} -n --line-numbers | grep ${ip} | head -1 | awk '{print $1}'`);
                const ruleNumber = stdout.trim();
                if (!ruleNumber) {
                    return false;
                }
                // Remove the rule
                yield execAsync(`sudo /sbin/iptables -D ${chain} ${ruleNumber}`);
                return true;
            }
            catch (error) {
                console.error(`Error removing rule for IP ${ip} from chain ${chain}:`, error);
                return false;
            }
        });
    }
    addTrafficCountingRules(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Validate inputs
                if (!userIP || !sessionId) {
                    throw new Error('userIP and sessionId are required');
                }
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                // Check if rules already exist
                const existingRules = yield this.checkExistingTrafficRules(userIP, sessionId);
                if (existingRules.download || existingRules.upload) {
                    yield this.removeTrafficCountingRules(sessionId);
                }
                // INSERT at position 1 (very beginning) - this is crucial!
                const downloadCmd = `sudo /sbin/iptables -I FORWARD 1 -d ${userIP} -m comment --comment "${downloadComment}" -j ACCEPT`;
                try {
                    yield execAsync(downloadCmd);
                }
                catch (error) {
                    console.error("Failed to add download rule:", error);
                    throw new Error(`Failed to add download rule: ${error}`);
                }
                // INSERT at position 2 (after the download rule we just added)
                const uploadCmd = `sudo /sbin/iptables -I FORWARD 2 -s ${userIP} -m comment --comment "${uploadComment}" -j ACCEPT`;
                try {
                    yield execAsync(uploadCmd);
                }
                catch (error) {
                    console.error("Failed to add upload rule:", error);
                    throw new Error(`Failed to add upload rule: ${error}`);
                }
                // Verify both rules were created successfully
                yield this.verifyTrafficRules(userIP, sessionId);
            }
            catch (error) {
                console.error(`Failed to add traffic counting for IP ${userIP}:`, error);
                throw error;
            }
        });
    }
    // Helper method to check existing rules
    checkExistingTrafficRules(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                // Check for existing rules
                const listCmd = `sudo /sbin/iptables -L FORWARD -n --line-numbers`;
                const output = yield execAsync(listCmd);
                const downloadExists = output.stdout.includes(downloadComment);
                const uploadExists = output.stdout.includes(uploadComment);
                return { download: downloadExists, upload: uploadExists };
            }
            catch (error) {
                console.error("Error checking existing rules:", error);
                return { download: false, upload: false };
            }
        });
    }
    verifyTrafficRules(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                const downloadCheck = yield execAsync(`sudo /sbin/iptables -L FORWARD -n | grep "${downloadComment}"`);
                const uploadCheck = yield execAsync(`sudo /sbin/iptables -L FORWARD -n | grep "${uploadComment}"`);
                if (!downloadCheck.stdout.trim()) {
                    throw new Error(`Download rule not found with comment: ${downloadComment}`);
                }
                if (!uploadCheck.stdout.trim()) {
                    throw new Error(`Upload rule not found with comment: ${uploadComment}`);
                }
            }
            catch (error) {
                console.error(`Traffic rule verification failed:`, error);
                throw error;
            }
        });
    }
    removeTrafficCountingRules(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                // Keep removing rules until none are found
                let removed = true;
                while (removed) {
                    removed = false;
                    try {
                        // Try to remove download rule
                        yield execAsync(`sudo /sbin/iptables -D FORWARD -m comment --comment "${downloadComment}" -j ACCEPT`);
                        removed = true;
                    }
                    catch (e) {
                        // No more download rules
                    }
                    try {
                        // Try to remove upload rule  
                        yield execAsync(`sudo /sbin/iptables -D FORWARD -m comment --comment "${uploadComment}" -j ACCEPT`);
                        removed = true;
                    }
                    catch (e) {
                        // No more upload rules
                    }
                }
            }
            catch (error) {
                console.error("Error cleaning up rules:", error);
            }
        });
    }
    startBackgroundTasks() {
        // Update session usage every minute
        this.usageUpdateJob = node_cron_1.default.schedule("* * * * *", () => __awaiter(this, void 0, void 0, function* () {
            yield this.updateSessionTimeUsage();
        }), { timezone: "UTC" });
        // Cleanup expired sessions every 2 minutes
        this.cleanupJob = node_cron_1.default.schedule("*/2 * * * *", () => __awaiter(this, void 0, void 0, function* () {
            yield this.cleanupExpiredSessions();
        }), { timezone: "UTC" });
    }
    stopBackgroundTasks() {
        if (this.usageUpdateJob) {
            this.usageUpdateJob.stop();
            this.usageUpdateJob = null;
        }
        if (this.cleanupJob) {
            this.cleanupJob.stop();
            this.cleanupJob = null;
        }
    }
    isValidIP(userIP) {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipv4Regex.test(userIP)) {
            return false;
        }
        const parts = userIP.split(".");
        return parts.every((part) => {
            const num = parseInt(part);
            return num >= 0 && num <= 255;
        });
    }
}
exports.FirewallManager = FirewallManager;
