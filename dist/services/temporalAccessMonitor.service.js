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
exports.TemporalAccessMonitor = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const mainServerClient_1 = __importDefault(require("./mainServerClient"));
``;
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class TemporalAccessMonitor {
    constructor() {
        this.activeMonitoring = new Map();
        this.monitoringIntervals = new Map();
        this.trafficStats = new Map();
    }
    // PARSE BYTES UTILITY
    parseBytes(byteString) {
        const units = {
            K: 1024,
            M: 1024 * 1024,
            G: 1024 * 1024 * 1024,
        };
        const match = byteString.match(/^(\d+\.?\d*)(\w*)$/);
        if (!match)
            return 0;
        const value = parseFloat(match[1]);
        const unit = match[2] || '';
        return value * (units[unit] || 1);
    }
    // GRANT MONITORED ACCESS
    grantMonitoredAccess(userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Validate inputs
                if (!this.isValidIP(userIP)) {
                    throw new Error('Invalid IP address');
                }
                // Check if user is banned
                const isBanned = yield mainServerClient_1.default.get(`/api/portal/blocked/check/${userIP}`);
                if (!isBanned.data.success) {
                    throw new Error('User is banned from accessing the network');
                }
                // Initialize chain if needed (safe to call multiple times)
                yield this.initializeTempAccessChain();
                // Store in database
                yield mainServerClient_1.default.post(`/api/portal/temp-access/activate`, { userIP });
                // Add IP to TEMP_ACCESS chain
                yield this.addIPToTempChain(userIP);
                // Start traffic monitoring
                yield this.startTrafficMonitoring(userIP, {
                    maxBandwidthMB: 50,
                    timeWindowMinutes: 3,
                    suspiciousPatterns: ['torrent', 'streaming', 'youtube', 'netflix', 'download']
                });
                // Auto-revoke after 3 minutes
                const revokeTimer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                    yield this.revokeTemporaryAccess(userIP);
                    console.log(`Auto-revoked access for user ${userIP} after 3 minutes`);
                }), 180000); // 3 minutes
                this.activeMonitoring.set(userIP, revokeTimer);
            }
            catch (error) {
                console.error('Error granting monitored access:', error);
                throw new Error('Failed to grant internet access');
            }
        });
    }
    revokeTemporaryAccess(userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Mark as inactive in database
                yield mainServerClient_1.default.post(`/api/portal/temp-access/deactivate`, { userIP });
                // Remove IP from TEMP_ACCESS chain instead of direct FORWARD rule
                yield this.removeIPFromTempChain(userIP);
                // Clear monitoring
                if (this.monitoringIntervals.has(userIP)) {
                    clearInterval(this.monitoringIntervals.get(userIP));
                    this.monitoringIntervals.delete(userIP);
                }
                // Clear active monitoring timer
                if (this.activeMonitoring.has(userIP)) {
                    clearTimeout(this.activeMonitoring.get(userIP));
                    this.activeMonitoring.delete(userIP);
                }
                console.log(`Temporary access revoked for user ${userIP}`);
            }
            catch (error) {
                console.error('Error revoking temporary access:', error);
            }
        });
    }
    // TRAFFIC MONITORING
    startTrafficMonitoring(userIP, options) {
        return __awaiter(this, void 0, void 0, function* () {
            // Initialize traffic stats for this IP
            this.trafficStats.set(userIP, {
                totalBytes: 0,
                lastChecked: new Date(),
                violations: []
            });
            const monitoringInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    // 1. BANDWIDTH MONITORING - Track cumulative usage
                    yield this.checkBandwidthUsage(userIP, options);
                    // 2. CONNECTION MONITORING - Check for suspicious activity
                    yield this.checkSuspiciousActivity(userIP, options);
                }
                catch (error) {
                    console.error('Traffic monitoring error:', error);
                }
            }), 30000); // Check every 30 seconds
            this.monitoringIntervals.set(userIP, monitoringInterval);
            setTimeout(() => {
                clearInterval(monitoringInterval);
                this.monitoringIntervals.delete(userIP);
                this.trafficStats.delete(userIP);
            }, options.timeWindowMinutes * 60 * 1000);
        });
    }
    checkBandwidthUsage(userIP, options) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Get current packet/byte counts from iptables
                const { stdout } = yield execAsync(`iptables -L TEMP_ACCESS -v -n | grep "${userIP}.*ACCEPT" || true`);
                if (stdout.trim()) {
                    // Parse iptables output: packets bytes target prot opt in out source destination
                    const lines = stdout.trim().split('\n');
                    let totalCurrentBytes = 0;
                    for (const line of lines) {
                        const columns = line.trim().split(/\s+/);
                        if (columns.length >= 2) {
                            const bytesStr = columns[1]; // Second column is bytes
                            const bytes = this.parseBytes(bytesStr);
                            totalCurrentBytes += bytes;
                        }
                    }
                    const stats = this.trafficStats.get(userIP);
                    if (stats) {
                        // Calculate new data since last check
                        const newBytes = totalCurrentBytes - stats.totalBytes;
                        const megabytesUsed = newBytes / (1024 * 1024);
                        console.log(`IP ${userIP}: ${megabytesUsed.toFixed(2)}MB since last check, total: ${(totalCurrentBytes / (1024 * 1024)).toFixed(2)}MB`);
                        // Update running total
                        stats.totalBytes = totalCurrentBytes;
                        stats.lastChecked = new Date();
                        // Check if total exceeds limit
                        const totalMB = totalCurrentBytes / (1024 * 1024);
                        if (totalMB > options.maxBandwidthMB) {
                            console.log(`Bandwidth limit exceeded for IP ${userIP}: ${totalMB.toFixed(2)}MB`);
                            yield this.blockUserForViolation(userIP, `Bandwidth limit exceeded for temporary access: ${totalMB.toFixed(2)}MB`);
                            return;
                        }
                        // Check for rapid usage (more than 10MB in 30 seconds = heavy usage)
                        if (megabytesUsed > 10) {
                            console.log(`Heavy bandwidth usage detected for IP ${userIP}: ${megabytesUsed.toFixed(2)}MB in 30 seconds`);
                            stats.violations.push(`Heavy usage: ${megabytesUsed.toFixed(2)}MB/30s`);
                            // Block after 3 violations
                            if (stats.violations.length >= 3) {
                                yield this.blockUserForViolation(userIP, `Repeated heavy usage violations`);
                                return;
                            }
                        }
                    }
                }
            }
            catch (error) {
                console.error(`Error checking bandwidth for ${userIP}:`, error);
            }
        });
    }
    checkSuspiciousActivity(userIP, options) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Check for too many concurrent connections
                const { stdout: connections } = yield execAsync(`ss -tuln state established | grep ${userIP} | wc -l`);
                const connectionCount = parseInt(connections.trim()) || 0;
                if (connectionCount > 50) { // More than 50 concurrent connections
                    console.log(`High connection count for IP ${userIP}: ${connectionCount} connections`);
                    yield this.blockUserForViolation(userIP, `High connection count: ${connectionCount} connections`);
                    return;
                }
                // Check for connections to known suspicious ports
                const suspiciousPorts = [6881, 6882, 6883, 6884, 6885, 6886, 6887, 6888, 6889]; // BitTorrent ports
                for (const port of suspiciousPorts) {
                    const { stdout: portCheck } = yield execAsync(`ss -tuln | grep ${userIP}.*:${port} | wc -l`);
                    const portConnections = parseInt(portCheck.trim()) || 0;
                    if (portConnections > 0) {
                        console.log(`Suspicious port activity for IP ${userIP}: ${portConnections} connections to port ${port}`);
                        yield this.blockUserForViolation(userIP, `Suspicious port usage: ${port}`);
                        return;
                    }
                }
            }
            catch (error) {
                console.error(`Error checking connections for ${userIP}:`, error);
            }
        });
    }
    blockUserForViolation(userIP, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`Revoking IP ${userIP} for: ${reason}`);
                // Revoke access immediately
                yield this.revokeTemporaryAccess(userIP);
                // Clean up monitoring
                if (this.monitoringIntervals.has(userIP)) {
                    clearInterval(this.monitoringIntervals.get(userIP));
                    this.monitoringIntervals.delete(userIP);
                }
                this.trafficStats.delete(userIP);
            }
            catch (error) {
                console.error(`Error blocking user ${userIP}:`, error);
            }
        });
    }
    initializeTempAccessChain() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Create TEMP_ACCESS chain if it doesn't exist
                yield execAsync('iptables -N TEMP_ACCESS 2>/dev/null || true');
                // Insert rule at the beginning of FORWARD chain to check TEMP_ACCESS chain
                // Check if rule already exists before adding
                const { stdout } = yield execAsync('iptables -L FORWARD --line-numbers -n');
                if (!stdout.includes('TEMP_ACCESS')) {
                    yield execAsync('iptables -I FORWARD 1 -j TEMP_ACCESS');
                }
                console.log('TEMP_ACCESS chain initialized');
            }
            catch (error) {
                console.error('Error initializing TEMP_ACCESS chain:', error);
                throw error;
            }
        });
    }
    addIPToTempChain(userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Add IP to TEMP_ACCESS chain (allow traffic from this IP)
                yield execAsync(`iptables -I TEMP_ACCESS -s ${userIP} -j ACCEPT`);
                console.log(`Added ${userIP} to TEMP_ACCESS chain`);
            }
            catch (error) {
                console.error(`Error adding ${userIP} to TEMP_ACCESS chain:`, error);
                throw error;
            }
        });
    }
    removeIPFromTempChain(userIP) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Remove IP from TEMP_ACCESS chain
                yield execAsync(`iptables -D TEMP_ACCESS -s ${userIP} -j ACCEPT 2>/dev/null || true`);
                console.log(`Removed ${userIP} from TEMP_ACCESS chain`);
            }
            catch (error) {
                console.error(`Error removing ${userIP} from TEMP_ACCESS chain:`, error);
                // Don't throw error here as cleanup should continue
            }
        });
    }
    // IP VALIDATION UTILITY
    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }
    // CLEANUP ALL MONITORING
    cleanupAll() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Clear all monitoring intervals
                for (const [userIP, interval] of this.monitoringIntervals) {
                    clearInterval(interval);
                    this.monitoringIntervals.delete(userIP);
                }
                // Clear all active monitoring timers
                for (const [userId, timer] of this.activeMonitoring) {
                    clearTimeout(timer);
                    this.activeMonitoring.delete(userId);
                }
                // Remove all temporary iptables rules
                yield execAsync(`iptables -F FORWARD`);
                console.log('All monitoring and temporary access rules cleared');
            }
            catch (error) {
                console.error('Error during cleanup:', error);
            }
        });
    }
    // GET MONITORING STATUS
    getMonitoringStatus(userId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.activeMonitoring.has(userId) || this.monitoringIntervals.has(userId);
        });
    }
}
exports.TemporalAccessMonitor = TemporalAccessMonitor;
