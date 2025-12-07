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
                // Verify chains exist (created by bash script)
                yield this.verifyChains();
                // Restore previous session state if requested
                if (restoreState) {
                    yield this.pauseActiveSessionState();
                }
                // Start background tasks
                this.startBackgroundTasks();
                this.isInitialized = true;
            }
            catch (error) {
                console.error(`Failed to initialize firewall manager:`, error);
                throw error;
            }
        });
    }
    /**
     * Add IP to whitelist and start tracking session
     * This adds BOTH FORWARD and NAT bypass rules
     */
    whitelistIP(sessionId, userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!this.isValidIP(userIP)) {
                    return { success: false, error: "Invalid IP address" };
                }
                // Check if rules already exist for this session
                const existingRules = yield this.checkExistingSessionRules(userIP, sessionId);
                if (existingRules.hasAllRules) {
                    return { success: true, sessionId };
                }
                // 1. Add traffic counting rules (4 rules: 2 counters + 2 accepts)
                yield this.addTrafficCountingRules(userIP, sessionId);
                // 2. Add NAT bypass so authenticated users skip captive portal
                yield execAsync(`sudo /sbin/iptables -t nat -I PREROUTING -s ${userIP} -m comment --comment "${this.contractId}_${sessionId}" -j RETURN`);
                return { success: true, sessionId };
            }
            catch (error) {
                console.error(`Error whitelisting IP ${userIP}:`, error);
                // Attempt cleanup on failure
                try {
                    yield this.removeTrafficCountingRules(sessionId, userIP);
                    yield this.removeNATBypassRule(userIP);
                }
                catch (cleanupError) {
                    console.error(`Cleanup after whitelist failure also failed:`, cleanupError);
                }
                return {
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                };
            }
        });
    }
    /**
     * Check if all rules already exist for a session
     */
    checkExistingSessionRules(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                const mainCommentUp = `${this.contractId}_${sessionId}_up`;
                const mainCommentDown = `${this.contractId}_${sessionId}_down`;
                const { stdout } = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n`);
                const hasDownloadCounter = stdout.includes(downloadComment);
                const hasUploadCounter = stdout.includes(uploadComment);
                const hasUploadAccept = stdout.includes(mainCommentUp);
                const hasDownloadAccept = stdout.includes(mainCommentDown);
                const missingRules = [];
                if (!hasDownloadCounter)
                    missingRules.push('download counter');
                if (!hasUploadCounter)
                    missingRules.push('upload counter');
                if (!hasUploadAccept)
                    missingRules.push('upload accept');
                if (!hasDownloadAccept)
                    missingRules.push('download accept');
                return {
                    hasAllRules: missingRules.length === 0,
                    missingRules
                };
            }
            catch (error) {
                console.error('Error checking existing rules:', error);
                return { hasAllRules: false, missingRules: [] };
            }
        });
    }
    /**
     * Remove IP from whitelist and cleanup
     * Removes BOTH FORWARD and NAT rules
     */
    revokeIPAccess(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // 1. Remove traffic counting rules (download, upload, and main ACCEPT)
                if (sessionId) {
                    yield this.removeTrafficCountingRules(sessionId);
                }
                // 2. Remove NAT bypass rule
                yield this.removeNATBypassRule(userIP);
                // 3. Kill active connections for immediate disconnect (optional but recommended)
                try {
                    yield execAsync(`sudo conntrack -D -s ${userIP} 2>/dev/null || true`);
                }
                catch (_a) {
                    // conntrack might not be available, that's okay
                }
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
    updateSessionTimeUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
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
            const response = yield mainServerClient_1.default.get(`/`);
            const data = response.data;
            return data.success ? data.data.sessions : [];
        });
    }
    getExpiredSessionsFromServer() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield mainServerClient_1.default.get(`/portal/sessions/expired?contractId=${this.contractId}`);
            const data = response.data;
            return data.success ? data.data.sessions : [];
        });
    }
    sendTimeUpdatesToServer(sessionUpdates) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield mainServerClient_1.default.put(`/portal/sessions/time`, { sessionUpdates });
            const data = yield response.data;
            return {
                updated: data.success ? data.data.successCount : 0,
                errors: data.success ? data.data.errorCount : sessionUpdates.length
            };
        });
    }
    markSessionsExpiredOnServer(sessionIds) {
        return __awaiter(this, void 0, void 0, function* () {
            yield mainServerClient_1.default.put(`/portal/sessions/expire`, {
                sessionIds
            });
        });
    }
    /**
     * Restore session state from database after server restart
     */
    pauseActiveSessionState() {
        return __awaiter(this, void 0, void 0, function* () {
            let paused = 0;
            let expired = 0;
            let errors = 0;
            try {
                // FIRST: Nuclear cleanup of ALL existing rules for this network
                yield this.nuclearCleanupAllRules();
                // Verify chains exist
                yield this.verifyChains();
                // Get all active sessions for this network from main server
                const sessions = yield this.getActiveSessionsFromServer();
                const validIPs = new Set();
                for (const session of sessions) {
                    try {
                        const { sessionId, remainingTimeSecs, userIP } = session;
                        if (!userIP || !this.isValidIP(userIP)) {
                            console.error(`Invalid IP for session ${sessionId}: ${userIP}`);
                            errors++;
                            continue;
                        }
                        // Skip expired sessions
                        if (remainingTimeSecs <= 0) {
                            expired++;
                            continue;
                        }
                        // Notify main server to pause the session
                        const pauseResponse = yield mainServerClient_1.default.post('/portal/sessions/pause', {
                            sessionId,
                            userIP,
                            contractId: process.env.CONTRACT_ID,
                        });
                        if (!pauseResponse.data.success) {
                            console.error(`Failed to pause session ${sessionId} for IP ${userIP}`);
                            errors++;
                            continue;
                        }
                        paused++;
                        // Small delay to avoid overwhelming the system
                        yield new Promise((resolve) => setTimeout(resolve, 100));
                    }
                    catch (error) {
                        console.error(`Failed to process session ${session.sessionId}:`, error);
                        errors++;
                    }
                }
                // Cleanup any stale firewall rules
                yield this.cleanupStaleRules(validIPs);
                return { paused, expired, errors };
            }
            catch (error) {
                console.error(`Session restoration failed:`, error);
                return { paused, expired, errors: errors + 1 };
            }
        });
    }
    /**
     * Nuclear cleanup - removes ALL rules for this contract/network
     */
    nuclearCleanupAllRules() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Clean FORWARD chain rules
                const { stdout: forwardRules } = yield execAsync(`sudo /sbin/iptables -L FORWARD -n --line-numbers | grep "_${this.contractId}_" | awk '{print $1}' | sort -nr`);
                const forwardRuleNumbers = forwardRules.trim().split('\n').filter(n => n);
                for (const ruleNum of forwardRuleNumbers) {
                    yield execAsync(`sudo /sbin/iptables -D FORWARD ${ruleNum} 2>/dev/null || true`);
                }
                // Clean AUTH chain rules (your existing code)
                const { stdout: authRules } = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n --line-numbers | grep "_${this.contractId}_" | awk '{print $1}' | sort -nr`);
                const authRuleNumbers = authRules.trim().split('\n').filter(n => n);
                for (const ruleNum of authRuleNumbers) {
                    yield execAsync(`sudo /sbin/iptables -D ${this.config.authChainName} ${ruleNum} 2>/dev/null || true`);
                }
                // Clean NAT PREROUTING rules (your existing code)
                const { stdout: natRules } = yield execAsync(`sudo /sbin/iptables -t nat -L PREROUTING -n --line-numbers | grep "${this.contractId}" | awk '{print $1}' | sort -nr`);
                const natRuleNumbers = natRules.trim().split('\n').filter(n => n);
                for (const ruleNum of natRuleNumbers) {
                    yield execAsync(`sudo /sbin/iptables -t nat -D PREROUTING ${ruleNum} 2>/dev/null || true`);
                }
            }
            catch (error) {
                console.error("Nuclear cleanup failed:", error);
            }
        });
    }
    /**
     * Cleanup stale firewall rules that don't match valid IPs
     * Removes both FORWARD and NAT rules
     */
    cleanupStaleRules(validIPs) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Clean stale FORWARD rules (only those with our contractId comment)
                const { stdout } = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n --line-numbers`);
                const lines = stdout.split("\n");
                const toRemove = [];
                for (const line of lines) {
                    // Only match rules with our contractId comment
                    if (line.includes(this.contractId)) {
                        // Match IP in either source OR destination position
                        const matchSource = line.match(/^ *(\d+) +ACCEPT +all +-- +([0-9.]+) +[0-9.]+/);
                        const matchDest = line.match(/^ *(\d+) +ACCEPT +all +-- +[0-9.]+ +([0-9.]+)/);
                        let lineNum = null;
                        let ip = null;
                        if (matchSource && matchSource[2] !== '0.0.0.0') {
                            lineNum = parseInt(matchSource[1]);
                            ip = matchSource[2];
                        }
                        else if (matchDest && matchDest[2] !== '0.0.0.0') {
                            lineNum = parseInt(matchDest[1]);
                            ip = matchDest[2];
                        }
                        if (lineNum && ip && !validIPs.has(ip)) {
                            toRemove.push({ line: lineNum, ip });
                        }
                    }
                }
                // Remove stale rules (reverse order)
                for (const rule of toRemove.reverse()) {
                    try {
                        yield execAsync(`sudo /sbin/iptables -D ${this.config.authChainName} ${rule.line}`);
                    }
                    catch (error) {
                        console.error(`Could not remove stale rule for IP ${rule.ip}:`, error);
                    }
                }
                // Remove stale FORWARD rules (reverse order)
                for (const rule of toRemove.reverse()) {
                    try {
                        yield execAsync(`sudo /sbin/iptables -D ${this.config.authChainName} ${rule.line}`);
                    }
                    catch (error) {
                        console.error(`Could not remove stale FORWARD rule for IP ${rule.ip}:`, error);
                    }
                }
                // Clean stale NAT rules (already filtered by contractId - this is fine)
                try {
                    const { stdout: natOut } = yield execAsync(`sudo /sbin/iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null || echo ""`);
                    if (!natOut || !natOut.includes('RETURN')) {
                        return;
                    }
                    const natLines = natOut.split("\n");
                    const natToRemove = [];
                    for (const line of natLines) {
                        // ✅ Only match NAT rules with our contractId
                        if (line.includes(this.contractId)) {
                            const match = line.match(/^ *(\d+) +RETURN +all +-- +([0-9.]+)/);
                            if (match) {
                                const [, lineNumStr, ip] = match;
                                if (!validIPs.has(ip)) {
                                    natToRemove.push({ line: parseInt(lineNumStr), ip });
                                }
                            }
                        }
                    }
                    // Remove stale NAT rules (reverse order)
                    for (const rule of natToRemove.reverse()) {
                        try {
                            yield execAsync(`sudo /sbin/iptables -t nat -D PREROUTING ${rule.line}`);
                        }
                        catch (error) {
                            console.error(`Could not remove stale NAT rule for IP ${rule.ip}:`, error);
                        }
                    }
                    const totalStale = toRemove.length + natToRemove.length;
                    if (totalStale > 0) {
                    }
                    else {
                        console.log('✓ No stale rules found');
                    }
                }
                catch (natError) {
                    console.error('No NAT rules to check (normal on first run)');
                }
            }
            catch (error) {
                console.error(`Failed to cleanup stale rules:`, error);
            }
        });
    }
    /**
     * Remove NAT bypass rule for an IP
     */
    removeNATBypassRule(ip) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get rule number for this IP from NAT PREROUTING
                const { stdout } = yield execAsync(`sudo /sbin/iptables -t nat -L PREROUTING -n --line-numbers | grep "${ip}" | grep RETURN | head -1 | awk '{print $1}'`);
                const ruleNumber = stdout.trim();
                if (!ruleNumber) {
                    return false;
                }
                // Remove the NAT rule
                yield execAsync(`sudo /sbin/iptables -t nat -D PREROUTING ${ruleNumber}`);
                return true;
            }
            catch (error) {
                console.error(`Error removing NAT rule for IP ${ip}:`, error);
                return false;
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
    verifyChains() {
        return __awaiter(this, void 0, void 0, function* () {
            const chains = [this.config.authChainName, this.config.blockChainName];
            for (const chain of chains) {
                try {
                    yield execAsync(`sudo /sbin/iptables -L ${chain} -n`);
                }
                catch (error) {
                    throw new Error(`Required chain '${chain}' does not exist. Please run the setup script first:\n` +
                        `  sudo ./setup-firewall.sh`);
                }
            }
        });
    }
    addTrafficCountingRules(userIP, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!userIP || !sessionId) {
                    throw new Error('userIP and sessionId are required');
                }
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                yield this.removeTrafficCountingRules(sessionId, userIP);
                // SECOND (becomes position 2): Upload counter and accept
                yield execAsync(`sudo /sbin/iptables -I ${this.config.authChainName} 1 -s ${userIP} -j ACCEPT -m comment --comment "${uploadComment}"`);
                // FIRST (becomes position 1): Download counter and accept
                const downloadCmd = `sudo /sbin/iptables -I ${this.config.authChainName} 1 -d ${userIP} -j ACCEPT -m comment --comment "${downloadComment}"`;
                const result = yield execAsync(downloadCmd);
                // Verify both rules exist
                const verify = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n | grep -E "(${downloadComment}|${uploadComment})" || true`);
                const lines = verify.stdout.trim().split('\n').filter(line => line.length > 0);
                const hasDownload = lines.some(line => line.includes(downloadComment));
                const hasUpload = lines.some(line => line.includes(uploadComment));
                if (!hasDownload || !hasUpload) {
                    throw new Error(`Missing rules! Download: ${hasDownload}, Upload: ${hasUpload}`);
                }
                const ruleCount = verify.stdout.trim().split('\n').length;
                if (ruleCount !== 2) {
                    throw new Error(`Expected 2 rules but only ${ruleCount} exist after insertion!`);
                }
            }
            catch (error) {
                console.error(`❌ Failed to add traffic counting:`, error);
                throw error;
            }
        });
    }
    removeTrafficCountingRules(sessionId, userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const downloadComment = `dl_${this.contractId}_${sessionId}`;
                const uploadComment = `ul_${this.contractId}_${sessionId}`;
                // Get line numbers for both rules (in reverse order)
                const { stdout } = yield execAsync(`sudo /sbin/iptables -L ZAANET_AUTH_USERS -n --line-numbers | grep -E "(${downloadComment}|${uploadComment})" | awk '{print $1}' | sort -rn`);
                const lineNumbers = stdout.trim().split('\n').filter(n => n);
                for (const lineNum of lineNumbers) {
                    yield execAsync(`sudo /sbin/iptables -D ZAANET_AUTH_USERS ${lineNum}`);
                }
            }
            catch (error) {
                console.error(`Error removing traffic counting rules:`, error);
            }
        });
    }
    startBackgroundTasks() {
        // Update session usage every minute
        this.usageUpdateJob = node_cron_1.default.schedule("* * * * *", () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.updateSessionTimeUsage();
            }
            catch (error) {
                console.error('Error in usage update job:', error);
            }
        }), { timezone: "UTC" });
        // Cleanup expired sessions every 2 minutes
        this.cleanupJob = node_cron_1.default.schedule("*/2 * * * *", () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.cleanupExpiredSessions();
            }
            catch (error) {
                console.error('Error in cleanup job:', error);
            }
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
    /**
     * Get current firewall statistics
     */
    getFirewallStats() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout: authOut } = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n | grep -c ACCEPT || echo 0`);
                const { stdout: natOut } = yield execAsync(`sudo /sbin/iptables -t nat -L PREROUTING -n | grep -c RETURN || echo 0`);
                const { stdout: blockOut } = yield execAsync(`sudo /sbin/iptables -L ${this.config.blockChainName} -n | grep -c DROP || echo 0`);
                return {
                    authRules: parseInt(authOut.trim()) || 0,
                    natRules: parseInt(natOut.trim()) || 0,
                    blockedRules: parseInt(blockOut.trim()) || 0,
                };
            }
            catch (error) {
                console.error('Error getting firewall stats:', error);
                return { authRules: 0, natRules: 0, blockedRules: 0 };
            }
        });
    }
    /**
     * List all active firewall rules for debugging
     */
    listActiveRules() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { stdout: authRules } = yield execAsync(`sudo /sbin/iptables -L ${this.config.authChainName} -n -v --line-numbers`);
                const { stdout: natRules } = yield execAsync(`sudo /sbin/iptables -t nat -L PREROUTING -n -v --line-numbers | grep RETURN || echo "No NAT bypass rules"`);
                const { stdout: blockRules } = yield execAsync(`sudo /sbin/iptables -L ${this.config.blockChainName} -n -v --line-numbers`);
                const stats = yield this.getFirewallStats();
            }
            catch (error) {
                console.error('Error listing rules:', error);
            }
        });
    }
}
exports.FirewallManager = FirewallManager;
